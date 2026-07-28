/**
 * 一次性：为 user_tracked_drugs 创建复合前缀索引。
 *
 * product_name + company_name 均为 varchar(500)，utf8mb4 下全长复合索引 4000 字节 > 3072 上限，
 * 必须用前缀索引 (product_name(255), company_name(255))（255*4*2=2040 < 3072）。
 * drizzle-kit push 无法正确生成前缀语法，故用原生 SQL 单独创建。
 *
 * 幂等：已存在则跳过。运行：pnpm add:index
 */
import { db } from '../src/storage/database/db';
import { sql } from 'drizzle-orm';

const INDEX_NAME = 'idx_utd_product_company';
const TABLE = 'user_tracked_drugs';

function extractRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

async function main() {
  // 幂等检查：索引是否已存在
  const existing = await db.execute(
    sql.raw(`SHOW INDEX FROM \`${TABLE}\` WHERE Key_name = '${INDEX_NAME}'`)
  );
  if (extractRows(existing).length > 0) {
    console.log(`✅ 索引 ${INDEX_NAME} 已存在，跳过`);
    return;
  }

  await db.execute(
    sql.raw(`CREATE INDEX \`${INDEX_NAME}\` ON \`${TABLE}\` (\`product_name\`(255), \`company_name\`(255))`)
  );
  console.log(`✅ 已创建前缀索引 ${INDEX_NAME} ON ${TABLE} (product_name(255), company_name(255))`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('创建索引失败:', e);
  process.exit(1);
});
