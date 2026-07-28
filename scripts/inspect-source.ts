/**
 * 一次性：探查源 PostgreSQL 库（SUPABASE_DB_URL）有哪些 public 表 + 各表行数。仅读。
 */
import { Pool } from 'pg';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('❌ SUPABASE_DB_URL 未设置');
  process.exit(1);
}

const pool = new Pool({ connectionString: url });

async function main() {
  const { rows: tables } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  if (tables.length === 0) {
    console.log('源库 public schema 无任何表');
    return;
  }
  console.log(`📋 源库现有 ${tables.length} 张表：`);
  for (const t of tables) {
    const name = t.tablename as string;
    try {
      const { rows } = await pool.query(`SELECT COUNT(*) AS c FROM "${name}"`);
      console.log(`   ${name.padEnd(30)} ${rows[0].c} 行`);
    } catch (e) {
      console.log(`   ${name.padEnd(30)} (查询失败: ${e instanceof Error ? e.message : e})`);
    }
  }
}

main()
  .then(async () => { await pool.end(); process.exit(0); })
  .catch(async e => { console.error('探查失败:', e); try { await pool.end(); } catch {} process.exit(1); });
