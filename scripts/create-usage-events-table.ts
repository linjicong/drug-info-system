/**
 * 一次性：创建 usage_events 埋点表（幂等，CREATE TABLE IF NOT EXISTS）。
 * 背景：drizzle-kit push 对既有表（drug_daily_ledgers 主键差异）报
 * ER_MULTIPLE_PRI_KEY，无法全量同步；新表改用原生 SQL 创建，与 schema.ts
 * 定义保持一致。
 * 注意：TiDB 经 drizzle 驱动执行 CREATE TABLE 时列内 KEY 定义不生效，
 * 二级索引改用 CREATE INDEX IF NOT EXISTS 单独创建（已实测幂等）。
 * 运行：pnpm create:usage-events（tsx --env-file=.env）
 */
import { db } from '../src/storage/database/db';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS \`usage_events\` (
      \`id\` bigint NOT NULL AUTO_INCREMENT,
      \`user_id\` varchar(64) NOT NULL,
      \`event_type\` varchar(30) NOT NULL,
      \`event_name\` varchar(100) NOT NULL,
      \`page_path\` varchar(200) NOT NULL,
      \`detail\` text,
      \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`)
    )`)
  );
  await db.execute(
    sql.raw('CREATE INDEX IF NOT EXISTS idx_usage_events_event_type ON `usage_events` (`event_type`)')
  );
  await db.execute(
    sql.raw('CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON `usage_events` (`created_at`)')
  );
  await db.execute(
    sql.raw('CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON `usage_events` (`user_id`)')
  );
  console.log('✅ usage_events 表与索引已就绪（幂等）');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('创建 usage_events 表失败:', e);
  process.exit(1);
});
