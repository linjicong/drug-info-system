import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { initUnifiedScheduler } from './lib/unified-scheduler';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

/**
 * 初始化所有数据源的定时调度器
 * 在服务启动时自动恢复已启用的定时任务
 */
async function initAllSchedulers(): Promise<void> {
  try {
    console.log('[Server] 正在初始化定时调度器...');
    await initUnifiedScheduler('gz_drug');
    await initUnifiedScheduler('gd_pubonln');
    console.log('[Server] 定时调度器初始化完成');
  } catch (error) {
    console.error('[Server] 定时调度器初始化失败:', error);
  }
}

app.prepare().then(async () => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );

    // 服务启动后自动初始化定时调度器
    initAllSchedulers();
  });
});
