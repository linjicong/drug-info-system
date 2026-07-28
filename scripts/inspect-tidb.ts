/**
 * 一次性：查看 TiDB 迁移后 scheduler_config 调度配置状态。仅读。
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
  const res = await db.execute(
    sql.raw('SELECT source, enabled, interval_minutes, next_run_at, last_run_status FROM scheduler_config ORDER BY source')
  );
  console.log('调度配置：');
  for (const r of extractRows(res)) {
    console.log(`   source=${String(r.source).padEnd(14)} enabled=${r.enabled} interval=${r.interval_minutes}min next_run=${r.next_run_at ?? '-'} last=${r.last_run_status ?? '-'}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
