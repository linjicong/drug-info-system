/**
 * Electron 主进程：拉起 Next.js standalone 本地服务并加载到窗口
 *
 * - 复用 Electron 内置 Node 运行时（ELECTRON_RUN_AS_NODE），无需额外捆绑 Node
 * - 服务目录：打包后 resources/server，开发模式 <repo>/.next/standalone
 * - 首次启动缺 DATABASE_URL 时弹出配置窗口，保存到 userData/config.env
 */
'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { checkForUpdates } = require('./updater.cjs');

const CONFIG_FILE_NAME = 'config.env';
const READY_TIMEOUT_MS = 60_000;
const RECENT_LOG_LINES = 50;
const BASE_PORT = 3000;
const PORT_PROBE_RANGE = 50;

let mainWindow = null;
let setupWindow = null;
let setupResolve = null;
let serverChild = null;
let quitting = false;
const recentLogs = [];

// ---------- 配置读写 ----------

/** 解析 KEY=VALUE 格式的 env 文件（忽略注释与空行，去掉首尾引号） */
function parseEnvFile(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

/**
 * 加载配置：userData/config.env 为准；
 * 开发模式（未打包）下先读仓库根 .env 作兜底，方便本地调试
 */
function loadConfig() {
  let config = {};
  if (!app.isPackaged) {
    const devEnvPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(devEnvPath)) {
      config = parseEnvFile(fs.readFileSync(devEnvPath, 'utf8'));
    }
  }
  const cfgPath = getConfigPath();
  if (fs.existsSync(cfgPath)) {
    Object.assign(config, parseEnvFile(fs.readFileSync(cfgPath, 'utf8')));
  }
  return config;
}

/** 合并写入单个配置项到 userData/config.env */
function saveConfigValue(key, value) {
  const cfgPath = getConfigPath();
  const existing = fs.existsSync(cfgPath) ? parseEnvFile(fs.readFileSync(cfgPath, 'utf8')) : {};
  existing[key] = value;
  const content = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, `${content}\n`, 'utf8');
}

// ---------- 首次启动配置窗口 ----------

function runSetupFlow() {
  return new Promise((resolve) => {
    setupResolve = resolve;
    setupWindow = new BrowserWindow({
      width: 620,
      height: 460,
      resizable: false,
      title: '首次启动配置 - 药品信息系统',
      webPreferences: {
        preload: path.join(__dirname, 'setup-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    setupWindow.setMenuBarVisibility(false);
    setupWindow.loadFile(path.join(__dirname, 'setup.html'));
    setupWindow.on('closed', () => {
      setupWindow = null;
      // 未保存直接关窗 → 视为取消，退出应用
      if (setupResolve) {
        const done = setupResolve;
        setupResolve = null;
        done(null);
      }
    });
  });
}

ipcMain.handle('setup:save', (_event, databaseUrl) => {
  const url = String(databaseUrl ?? '').trim();
  if (!url) {
    return { ok: false, error: '请输入 TiDB 数据库连接串' };
  }
  try {
    saveConfigValue('DATABASE_URL', url);
  } catch (error) {
    return { ok: false, error: `保存配置失败: ${error instanceof Error ? error.message : String(error)}` };
  }
  const config = loadConfig();
  if (setupWindow) {
    const win = setupWindow;
    setupWindow = null;
    win.close();
  }
  if (setupResolve) {
    const done = setupResolve;
    setupResolve = null;
    done(config);
  }
  return { ok: true };
});

// ---------- 本地服务管理 ----------

function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

async function findFreePort() {
  for (let port = BASE_PORT; port < BASE_PORT + PORT_PROBE_RANGE; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`未找到可用端口（${BASE_PORT}-${BASE_PORT + PORT_PROBE_RANGE - 1}）`);
}

function getServerDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', '.next', 'standalone');
}

function pushLog(chunk) {
  const text = chunk.toString();
  process.stdout.write(text);
  recentLogs.push(...text.split(/\r?\n/));
  if (recentLogs.length > RECENT_LOG_LINES) {
    recentLogs.splice(0, recentLogs.length - RECENT_LOG_LINES);
  }
}

function tailLogs(lines = 20) {
  return recentLogs.slice(-lines).join('\n') || '（无日志输出）';
}

/** 轮询本地服务直至返回任意 HTTP 响应（404 也算就绪） */
function waitForReady(child, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;

    function retry() {
      if (Date.now() > deadline) {
        reject(new Error(`服务在 ${timeoutMs / 1000} 秒内未就绪，最近日志：\n${tailLogs()}`));
        return;
      }
      setTimeout(probe, 500);
    }

    function probe() {
      if (child.exitCode !== null) {
        reject(new Error(`服务进程已退出（退出码 ${child.exitCode}），最近日志：\n${tailLogs()}`));
        return;
      }
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
      req.on('error', retry);
    }

    probe();
  });
}

async function startServer(config) {
  const serverDir = getServerDir();
  const serverJs = path.join(serverDir, 'server.js');
  if (!fs.existsSync(serverJs)) {
    throw new Error(`服务入口不存在: ${serverJs}\n请先执行 pnpm build 生成 standalone 产物。`);
  }

  const port = await findFreePort();
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    RUN_LOCAL_RUNNER: '1',
    DATABASE_URL: config.DATABASE_URL,
  };
  if (config.CRON_SECRET) {
    env.CRON_SECRET = config.CRON_SECRET;
  }
  // 打包产物的依赖目录改名 server_modules（electron-builder 硬编码排除根级
  // node_modules），通过 NODE_PATH 补上模块解析；开发模式的 standalone 自带
  // node_modules，无需注入
  const serverModulesDir = path.join(serverDir, 'server_modules');
  if (fs.existsSync(serverModulesDir)) {
    env.NODE_PATH = serverModulesDir;
  }

  console.log(`[Desktop] 启动本地服务: ${serverJs} (port=${port})`);
  const child = spawn(process.execPath, [serverJs], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  serverChild = child;

  await waitForReady(child, port, READY_TIMEOUT_MS);
  console.log(`[Desktop] 本地服务就绪: http://127.0.0.1:${port}`);
  return port;
}

/** 退出时终止服务子进程（Windows 下结束整个进程树） */
function killServer() {
  if (!serverChild) return;
  const child = serverChild;
  serverChild = null;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    child.kill('SIGTERM');
  }
}

// ---------- 窗口与应用生命周期 ----------

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: '药品信息系统',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function onReady() {
  let config = loadConfig();

  // 首次启动：缺数据库连接串时先走配置引导
  if (!config.DATABASE_URL) {
    const saved = await runSetupFlow();
    if (!saved) {
      app.quit();
      return;
    }
    config = saved;
  }

  try {
    const port = await startServer(config);
    createMainWindow(`http://127.0.0.1:${port}`);
  } catch (error) {
    dialog.showErrorBox('启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
    return;
  }

  // 延迟检查新版本（latest.yml 泛型更新源，未配置更新地址时静默跳过）
  setTimeout(() => {
    checkForUpdates().catch((error) => console.warn('[Desktop] 更新检查失败:', error?.message || error));
  }, 5_000);

  // 服务进程意外退出（非主动关闭）→ 提示后退出应用
  serverChild.on('exit', (code) => {
    if (quitting) return;
    dialog.showErrorBox('服务意外退出', `本地服务进程已终止（退出码 ${code}），应用即将退出。\n最近日志：\n${tailLogs()}`);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(onReady);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    killServer();
  });
}
