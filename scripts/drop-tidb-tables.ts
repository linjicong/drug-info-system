/**
 * 一次性：drop 目标库全部表，用于清理半成品结构后重新干净 push。
 * ⚠️ 会删除所有表。仅在目标库为迁移中间产物、确认无有效数据时使用。
 */
import { db } from '../src/storage/database/db';
import { sql } from 'drizzle-orm';

function extractRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    return (result as { rows: Record<string, unknown>[] }).rows;
  }
  return [];
}

async function main() {
  const tablesRes = await db.execute(sql.raw('SHOW TABLES'));
  const tableNames = extractRows(tablesRes).map(r => String(Object.values(r)[0]));

  if (tableNames.length === 0) {
    console.log('✅ 库已为空，无需 drop');
    return;
  }

  // 安全兜底：drop 前再确认全部为空，任何一张非空则中止
  for (const t of tableNames) {
    const cntRes = await db.execute(sql.raw(`SELECT COUNT(*) AS c FROM \`${t}\``));
    const c = Number(Object.values(extractRows(cntRes)[0] ?? { c: 0 })[0] ?? 0);
    if (c > 0) {
      console.error(`❌ 中止：${t} 有 ${c} 行数据，拒绝 drop`);
      process.exit(1);
    }
  }

  console.log(`🗑️  drop ${tableNames.length} 张空表...`);
  await db.execute(sql.raw('SET FOREIGN_KEY_CHECKS = 0'));
  for (const t of tableNames) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${t}\``));
    console.log(`   dropped ${t}`);
  }
  await db.execute(sql.raw('SET FOREIGN_KEY_CHECKS = 1'));
  console.log('✅ 全部 drop 完成，可重新 pnpm drizzle-kit push');
}

main().then(() => process.exit(0)).catch(e => {
  console.error('drop 失败:', e);
  process.exit(1);
});
