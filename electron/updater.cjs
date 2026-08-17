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

const { app, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const MAX_REDIRECTS = 3;

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

/** 流式下载安装包并校验 sha512（base64），返回落盘路径 */
function downloadAndVerify(url, destPath, expectedSha512) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const out = fs.createWriteStream(destPath);
    const hash = crypto.createHash('sha512');
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        out.close();
        resolve(downloadAndVerify(new URL(res.headers.location, url), destPath, expectedSha512));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        out.close();
        reject(new Error(`下载失败：HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(hash).pipe(out);
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

/** NSIS 安装版：后台下载校验后引导安装 */
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
  try {
    await downloadAndVerify(new URL(file.url, base), dest, file.sha512);
  } catch (error) {
    dialog.showErrorBox('更新失败', error instanceof Error ? error.message : String(error));
    return;
  }

  const { response: install } = await dialog.showMessageBox({
    type: 'info',
    title: '更新已就绪',
    message: '新版安装包下载完成，退出应用并开始安装？',
    buttons: ['退出并安装', '稍后手动安装'],
    defaultId: 0,
    cancelId: 1,
    detail: `安装包位置：${dest}`,
  });
  if (install !== 0) return;

  // 拉起安装向导后立即退出，避免占用安装目录文件
  spawn(dest, [], { detached: true, stdio: 'ignore' });
  app.quit();
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

module.exports = { checkForUpdates, parseLatestYml, compareVersions };
