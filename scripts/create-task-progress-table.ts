/**
 * 一次性：创建 task_progress 表（跨进程任务进度，GitHub Actions runner 写、API 读）。
 *
 * 幂等：CREATE TABLE IF NOT EXISTS。
 * 运行：pnpm create:progress-table（tsx --env-file=.env）
 */
import { db } from '../src/storage/database/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS \`task_progress\` (
      \`source\` varchar(50) NOT NULL,
      \`status\` varchar(20) NOT NULL DEFAULT 'idle',
      \`phase\` varchar(100) DEFAULT NULL,
      \`counters\` text,
      \`start_time\` datetime DEFAULT NULL,
      \`end_time\` datetime DEFAULT NULL,
      \`error\` text,
      \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`source\`)
    )`)
  );
  console.log('✅ task_progress 表已就绪（CREATE TABLE IF NOT EXISTS）');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('创建 task_progress 表失败:', e);
  process.exit(1);
});
