/**
 * 轻量自动更新器（不依赖 electron-updater，避免 pnpm 隔离下的依赖打包问题）
 *
 * 更新源：electron-builder generic publish——构建时若注入 UPDATE_URL，
 * desktop-build.mjs 会向 electron-builder.yml 追加 publish 配置，打包产物
 * resources/app-update.yml 中即带有更新地址。
 *
 * - NSIS 安装版：下载新版安装包 → sha512 校验 → 引导安装向导完成升级
 * - portable 便携版：运行时为自解压临时目录，无法原地更新，仅提示并引导下载
 */
'use strict';

const { app, dialog, shell, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const MAX_REDIRECTS = 3;
const PROGRESS_THROTTLE_MS = 200;

let progressWindow = null;
let updateSession = null; // { active, base, file, dest, win } 当前下载会话

/** 从 resources/app-update.yml 读取 generic publish 地址（未配置则返回 null） */
function readPublishUrl() {
  if (!app.isPackaged) return null;
  const ymlPath = path.join(process.resourcesPath, 'app-update.yml');
  if (!fs.existsSync(ymlPath)) return null;
  const text = fs.readFileSync(ymlPath, 'utf8');
  if (!/provider:\s*generic/.test(text)) return null;
  const m = /^url:\s*(.+)$/m.exec(text);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

/** 字节数格式化：B / KB / MB / GB */
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/** 语义化版本比较：a > b 返回正数，相等返回 0 */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** 带重定向与超时的文本抓取 */
function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('重定向次数过多'));
          return;
        }
        resolve(fetchText(new URL(res.headers.location, url), redirects + 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

/** 解析 latest.yml：版本号 + 各产物的下载地址与 sha512 */
function parseLatestYml(text) {
  const versionMatch = /^version:\s*(.+)$/m.exec(text);
  const version = versionMatch ? versionMatch[1].trim() : null;
  const files = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*-\s*url:\s*(.+)$/.exec(lines[i]);
    if (!m) continue;
    let sha512 = null;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const s = /^\s*sha512:\s*(.+)$/.exec(lines[j]);
      if (s) {
        sha512 = s[1].trim();
        break;
      }
    }
    files.push({ url: m[1].trim(), sha512 });
  }
  return { version, files };
}

/**
 * 流式下载安装包并校验 sha512（base64），返回落盘路径
 * onProgress: ({ percent, received, total, bytesPerSecond }) => void，节流推送
 */
function downloadAndVerify(url, destPath, expectedSha512, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(destPath);
    const hash = crypto.createHash('sha512');
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        out.close();
        resolve(downloadAndVerify(new URL(res.headers.location, url), destPath, expectedSha512, onProgress));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        out.close();
        reject(new Error(`下载失败：HTTP ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || 0;
      let received = 0;
      let lastTick = Date.now();
      let lastBytes = 0;
      // 注意：Hash 流作管道中介时其可读侧输出的是摘要本身（64B），会把安装包
      // 内容覆盖成摘要——数据必须直写文件，hash 在 data 监听中并行 update
      res.pipe(out);
      res.on('data', (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        if (!onProgress) return;
        const now = Date.now();
        const elapsed = (now - lastTick) / 1000;
        // 节流推送，最后一块强制上报保证 100%
        if (elapsed < PROGRESS_THROTTLE_MS / 1000 && received !== total) return;
        const bytesPerSecond = elapsed > 0 ? Math.round((received - lastBytes) / elapsed) : 0;
        lastTick = now;
        lastBytes = received;
        onProgress({
          percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
          received,
          total,
          bytesPerSecond,
        });
      });
      // 响应结束时补发最终进度（无 Content-Length 时 data 节流可能从未触发上报）
      res.on('end', () => {
        if (!onProgress || received <= lastBytes) return;
        const elapsed = (Date.now() - lastTick) / 1000;
        onProgress({
          percent: total > 0 ? 100 : null,
          received,
          total,
          bytesPerSecond: elapsed > 0 ? Math.round((received - lastBytes) / elapsed) : 0,
        });
      });
      out.on('finish', () => {
        out.close(() => {
          const actual = hash.digest('base64');
          if (expectedSha512 && actual !== expectedSha512) {
            fs.rmSync(destPath, { force: true });
            reject(new Error('安装包 sha512 校验不通过，已丢弃'));
            return;
          }
          resolve(destPath);
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('下载超时')));
    req.on('error', reject);
  });
}

/** portable 版：仅提示新版本并引导浏览器下载 */
async function notifyPortableUpdate(base, file) {
  const downloadUrl = new URL(file.url, base).href;
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `检测到新版本（当前 ${app.getVersion()}），便携版无法自动更新，是否前往下载？`,
    buttons: ['前往下载', '暂不'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    shell.openExternal(downloadUrl);
  }
}

// ---------- 更新进度窗口 ----------

/** 获取更新进度窗口（已存在则复用并前置） */
function getProgressWindow() {
  if (progressWindow && !progressWindow.isDestroyed()) {
    progressWindow.show();
    return progressWindow;
  }
  progressWindow = new BrowserWindow({
    width: 420,
    height: 250,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: '软件更新 - 药品信息系统',
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  progressWindow.setMenuBarVisibility(false);
  progressWindow.loadFile(path.join(__dirname, 'update-progress.html'));
  // 下载进行中关闭窗口 → 隐藏而非销毁，下载继续，完成后自动重新弹出
  progressWindow.on('close', (event) => {
    if (updateSession && updateSession.active) {
      event.preventDefault();
      progressWindow.hide();
    }
  });
  progressWindow.on('closed', () => {
    progressWindow = null;
  });
  return progressWindow;
}

/** 执行下载：推送进度，成功/失败通知进度窗口；窗口不可用时回落系统弹窗 */
function startDownload(win, base, file, dest) {
  const session = { active: true, base, file, dest, win };
  updateSession = session;
  if (win && !win.isDestroyed()) {
    win.webContents.send('update:reset');
  }

  const onProgress = (progress) => {
    if (session.active && win && !win.isDestroyed()) {
      win.webContents.send('update:progress', progress);
    }
  };

  const fail = (message) => {
    // 保留会话（active=false）供“重试”按钮复用下载参数
    session.active = false;
    if (!win || win.isDestroyed()) {
      dialog.showErrorBox('更新失败', message);
      return;
    }
    win.show();
    win.webContents.send('update:error', message);
  };

  const succeed = () => {
    // 保留会话（active=false）供“立即重启更新”按钮使用安装包路径
    session.active = false;
    if (!win || win.isDestroyed()) {
      dialog.showMessageBox({
        type: 'info',
        title: '更新已就绪',
        message: '新版安装包下载完成，可重启应用安装更新。',
        detail: `安装包位置：${dest}`,
      });
      return;
    }
    win.show();
    win.webContents.send('update:ready', { filePath: dest });
  };

  downloadAndVerify(new URL(file.url, base), dest, file.sha512, onProgress)
    .then(succeed)
    .catch((error) => fail(error instanceof Error ? error.message : String(error)));
}

// 进度窗口“立即重启更新”：拉起安装向导后立即退出，避免占用安装目录文件
ipcMain.on('update:install', () => {
  if (!updateSession || updateSession.active || !fs.existsSync(updateSession.dest)) return;
  spawn(updateSession.dest, [], { detached: true, stdio: 'ignore' });
  app.quit();
});

// 进度窗口“重试”：重新开始下载（上次失败已结束会话）
ipcMain.on('update:retry', () => {
  if (!updateSession || updateSession.active) return;
  const { base, file, dest, win } = updateSession;
  startDownload(win, base, file, dest);
});

// 进度窗口“稍后/关闭”：下载中→隐藏，已就绪/失败→真正关闭
ipcMain.on('update:close', () => {
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close();
});

/** NSIS 安装版：下载时展示进度窗口，完成后提示重启更新 */
async function applyInstallerUpdate(base, file) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `检测到新版本（当前 ${app.getVersion()}），是否现在下载更新？`,
    buttons: ['下载更新', '暂不'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) return;

  const fileName = decodeURIComponent(file.url.split('/').pop() || 'update.exe');
  const dest = path.join(app.getPath('userData'), 'updates', fileName);
  const win = getProgressWindow();
  // 页面未加载完成时等 did-finish-load 再启动下载，保证首条进度能显示
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', () => startDownload(win, base, file, dest));
  } else {
    startDownload(win, base, file, dest);
  }
}

/**
 * 更新检查入口（静默失败，不阻塞主流程）：
 * 拉取 latest.yml → 版本比较 → 按安装形态分发处理
 */
async function checkForUpdates() {
  if (!app.isPackaged) return;
  const publishUrl = readPublishUrl();
  if (!publishUrl) return;

  const base = new URL(publishUrl.endsWith('/') ? publishUrl : `${publishUrl}/`);
  const latest = parseLatestYml(await fetchText(new URL('latest.yml', base)));
  if (!latest.version || compareVersions(latest.version, app.getVersion()) <= 0) return;

  const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  const file = latest.files.find((f) =>
    isPortable ? /portable/i.test(f.url) : /\.exe$/i.test(f.url) && !/portable/i.test(f.url),
  );
  if (!file) return;

  if (isPortable) {
    await notifyPortableUpdate(base, file);
  } else {
    await applyInstallerUpdate(base, file);
  }
}

module.exports = { checkForUpdates, parseLatestYml, compareVersions, downloadAndVerify };
