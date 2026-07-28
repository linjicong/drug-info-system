/**
 * 历史数据一次性迁移脚本：Supabase (PostgreSQL) -> TiDB Cloud (MySQL)
 *
 * 使用步骤：
 *   1. 配置 .env：
 *        DATABASE_URL      - TiDB Cloud 目标库连接串
 *        SUPABASE_DB_URL   - 源 Supabase PostgreSQL 连接串（Session pooler / 5432）
 *   2. 确保 TiDB 表已创建（执行 pnpm drizzle-kit push）
 *   3. 运行：pnpm migrate:data
 *
 * 特性：
 *   - 类型转换：timestamptz/timestamp（pg 返回 Date）-> UTC 'YYYY-MM-DD HH:mm:ss'（避免时区偏移）；int4 -> string
 *   - 幂等：每表先清空再导入，可重复运行
 *   - 分页读取源表（每批 500 行），避免内存溢出
 *   - 双重校验：行数比对 + 字段抽样比对（每表首 3 行关键字段）
 *   - 迁移完成后可移除 SUPABASE_DB_URL 与本脚本
 *
 * Supabase 连接说明：
 *   - Dashboard -> Project Settings -> Database -> Connection string 选 "Session pooler"（端口 5432）；
 *     不要用 Transaction pooler（6543），它不支持 prepared statement，pg 会在首个带参查询报错。
 *   - 连接串末尾必须加 ?sslmode=require 启用 SSL（Supabase 强制要求）。
 *   - 格式：postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require
 */

import { Pool } from 'pg';
import { db } from '../src/storage/database/db';
import * as schema from '../src/storage/database/shared/schema';
import { eq, getTableColumns } from 'drizzle-orm';

function getRequiredEnv(key: string, hint: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`❌ ${key} 必须设置（${hint}）`);
    process.exit(1);
  }
  return v;
}

const supabaseDbUrl = getRequiredEnv('SUPABASE_DB_URL', '源 Supabase PostgreSQL 连接串，Session pooler 5432');
getRequiredEnv('DATABASE_URL', 'TiDB Cloud 目标库'); // fail-fast；运行时由 db.ts 懒加载校验

// Session pooler (5432) 支持默认的 prepared statement；若误用 6543 会在首个带参查询报错
const pool = new Pool({ connectionString: supabaseDbUrl });

const BATCH_SIZE = 500;

interface TableMigration {
  name: string;
  supabaseTable: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemaTable: any;
}

// 迁移顺序（依赖在前）：配置表 -> 业务表 -> 台账历史
const TABLES: TableMigration[] = [
  { name: 'health_check', supabaseTable: 'health_check', schemaTable: schema.healthCheck },
  { name: 'scheduler_config', supabaseTable: 'scheduler_config', schemaTable: schema.schedulerConfig },
  { name: 'pubonln_scheduler_config', supabaseTable: 'pubonln_scheduler_config', schemaTable: schema.pubonlnSchedulerConfig },
  { name: 'unified_scheduler_config', supabaseTable: 'unified_scheduler_config', schemaTable: schema.unifiedSchedulerConfig },
  { name: 'scrape_log', supabaseTable: 'scrape_log', schemaTable: schema.scrapeLog },
  { name: 'drug_info', supabaseTable: 'drug_info', schemaTable: schema.drugInfo },
  { name: 'pubonln_drug_info', supabaseTable: 'pubonln_drug_info', schemaTable: schema.pubonlnDrugInfo },
  { name: 'user_tracked_drugs', supabaseTable: 'user_tracked_drugs', schemaTable: schema.userTrackedDrugs },
  { name: 'merged_drug_info', supabaseTable: 'merged_drug_info', schemaTable: schema.mergedDrugInfo },
  { name: 'drug_daily_ledgers', supabaseTable: 'drug_daily_ledgers', schemaTable: schema.drugDailyLedgers },
];

/**
 * 按目标表列类型构建"DB列名 -> columnType"映射，用于精确决定每列的转换方式。
 * drizzle 插入时对不同列模式要求不同输入类型：
 *   - MySqlDateTime（Date 模式）内部调 value.toISOString()，必须给 Date 对象
 *   - MySqlDateTimeString / MySqlDateString（string 模式）必须给字符串
 */
function buildColumnTypeMap(schemaTable: unknown): Map<string, string> {
  const map = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cols = getTableColumns(schemaTable as any) as Record<string, { name: string; columnType: string }>;
  for (const col of Object.values(cols)) {
    map.set(col.name, col.columnType);
  }
  return map;
}

/**
 * 规整源行类型以适配 TiDB MySQL，按目标列 columnType 精确转换：
 * - MySqlDateTime（Date 模式）：pg 返回 Date -> 原样透传（drizzle 内部 toISOString 得 UTC）
 * - MySqlDateTimeString / MySqlDateString（string 模式）：Date -> UTC 'YYYY-MM-DD HH:mm:ss' 字符串；已是字符串则透传
 * - number（int4）-> string；boolean / numeric(string) / varchar / text 原样透传
 */
function normalizeRow(
  row: Record<string, unknown>,
  colTypes: Map<string, string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const colType = colTypes.get(key);
    if (value instanceof Date) {
      // Date 模式列要 Date 对象；string 模式列要 UTC 字符串
      if (colType === 'MySqlDateTimeString' || colType === 'MySqlDateString') {
        out[key] = value.toISOString().slice(0, 19).replace('T', ' ');
      } else {
        out[key] = value;
      }
    } else if (typeof value === 'number') {
      out[key] = String(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function getSourceCount(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM "${table}"`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * 获取源库 public schema 下实际存在的表名集合。
 * 源库（火山引擎 PG）可能缺少 schema 里的"保留兼容"旧表，需据此优雅跳过而非中断。
 */
async function getSourceTables(): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  return new Set(rows.map(r => r.tablename as string));
}

/**
 * 字段抽样比对：对源首 3 行，按 id 查 TiDB 目标行，比对关键字段值。
 * 跳过时间字段（已 normalize，格式差异属正常）。
 */
async function verifySample(
  m: TableMigration,
  sourceSample: Record<string, unknown>[]
): Promise<boolean> {
  let ok = true;
  for (const src of sourceSample) {
    const id = src.id;
    if (!id) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = await db
        .select()
        .from(m.schemaTable)
        .where(eq(m.schemaTable.id as never, id))
        .limit(1);
      const tgt = target[0] as Record<string, unknown> | undefined;
      if (!tgt) {
        console.warn(`⚠️  ${m.name} 抽样: id=${id} 目标未找到`);
        ok = false;
        continue;
      }
      for (const key of Object.keys(src)) {
        const sv = src[key];
        const tv = tgt[key];
        if (sv == null || tv == null) continue;
        if (typeof sv === 'number' && typeof tv === 'string') {
          if (Number(tv) !== sv) {
            console.warn(`⚠️  ${m.name} id=${id} ${key}: 源 ${sv} 目标 ${tv}`);
            ok = false;
          }
        } else if (typeof sv === 'string' && typeof tv === 'string' && sv !== tv) {
          // 跳过时间字段（已 normalize）
          if (!/^\d{4}-\d{2}-\d{2}/.test(sv)) {
            console.warn(`⚠️  ${m.name} id=${id} ${key}: 源 "${sv}" 目标 "${tv}"`);
            ok = false;
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️  ${m.name} 抽样查询失败:`, e instanceof Error ? e.message : e);
      ok = false;
    }
  }
  return ok;
}

async function migrateTable(
  m: TableMigration,
  sourceTables: Set<string>
): Promise<{ source: number; migrated: number; sampleOk: boolean; skipped: boolean }> {
  // 源库不存在该表：跳过（保留兼容的旧表可能未在源库建立）
  if (!sourceTables.has(m.supabaseTable)) {
    console.log(`\n📋 ${m.name}: 源库无此表，跳过`);
    return { source: 0, migrated: 0, sampleOk: true, skipped: true };
  }

  const sourceCount = await getSourceCount(m.supabaseTable);
  console.log(`\n📋 ${m.name}: 源 ${sourceCount} 行`);

  if (sourceCount === 0) {
    console.log(`   跳过（空表），仍清空目标表以保证幂等`);
    await db.delete(m.schemaTable);
    return { source: 0, migrated: 0, sampleOk: true, skipped: false };
  }

  // 清空目标表（幂等：可重复运行）
  await db.delete(m.schemaTable);

  const colTypes = buildColumnTypeMap(m.schemaTable);
  let offset = 0;
  let migrated = 0;
  let sampleRows: Record<string, unknown>[] = [];

  while (offset < sourceCount) {
    let rows: Record<string, unknown>[];
    try {
      const result = await pool.query(
        `SELECT * FROM "${m.supabaseTable}" ORDER BY id LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, offset]
      );
      rows = result.rows as Record<string, unknown>[];
    } catch (e) {
      throw new Error(`读取 ${m.supabaseTable} 失败 (offset ${offset}): ${e instanceof Error ? e.message : e}`);
    }

    if (rows.length === 0) break;

    const normalized = rows.map(row => normalizeRow(row, colTypes));

    // 保留首批前 3 行用于抽样比对
    if (offset === 0 && normalized.length > 0) {
      sampleRows = normalized.slice(0, 3);
    }

    // 批量插入 TiDB（as never 绕过类型：已 normalize 为 MySQL 兼容类型）
    await db.insert(m.schemaTable).values(normalized as never);

    migrated += rows.length;
    offset += BATCH_SIZE;
    console.log(`   已迁移 ${migrated}/${sourceCount}`);
  }

  // 行数校验
  if (migrated !== sourceCount) {
    console.warn(`⚠️  ${m.name} 行数不一致: 源 ${sourceCount}, 迁移 ${migrated}`);
  } else {
    console.log(`✅ ${m.name} 迁移完成: ${migrated} 行`);
  }

  // 字段抽样比对
  let sampleOk = true;
  if (sampleRows.length > 0) {
    sampleOk = await verifySample(m, sampleRows);
    if (sampleOk) {
      console.log(`✅ ${m.name} 抽样比对通过（${sampleRows.length} 行）`);
    } else {
      console.warn(`⚠️  ${m.name} 抽样比对发现差异，请检查上方告警`);
    }
  }

  return { source: sourceCount, migrated, sampleOk, skipped: false };
}

async function main() {
  console.log('🚀 开始数据迁移: Supabase (PostgreSQL) -> TiDB Cloud');
  console.log(`   源:   ${supabaseDbUrl.replace(/:[^:@]+@/, ':****@')}`);
  console.log(`   目标: TiDB Cloud (DATABASE_URL)`);

  const sourceTables = await getSourceTables();

  const results: Array<{ name: string; source: number; migrated: number; sampleOk: boolean; skipped: boolean }> = [];

  for (const m of TABLES) {
    const r = await migrateTable(m, sourceTables);
    results.push({ name: m.name, ...r });
  }

  await pool.end();

  console.log('\n📊 迁移汇总:');
  for (const r of results) {
    if (r.skipped) {
      console.log(`   ⏭️  ${r.name.padEnd(26)} 源库无此表，跳过`);
      continue;
    }
    const countStatus = r.source === r.migrated ? '✅' : '⚠️';
    const sampleStatus = r.sampleOk ? '✅' : '⚠️';
    console.log(`   ${countStatus}${sampleStatus} ${r.name.padEnd(26)} 源 ${r.source} -> 迁移 ${r.migrated}`);
  }

  const migratedResults = results.filter(r => !r.skipped);
  const totalSource = migratedResults.reduce((s, r) => s + r.source, 0);
  const totalMigrated = migratedResults.reduce((s, r) => s + r.migrated, 0);
  const allSampleOk = migratedResults.every(r => r.sampleOk);
  const skippedCount = results.filter(r => r.skipped).length;
  const skipNote = skippedCount > 0 ? `（另跳过 ${skippedCount} 张源库不存在的表）` : '';

  if (totalSource === totalMigrated && allSampleOk) {
    console.log(`\n✅ 全部迁移成功: ${totalMigrated} 行，抽样比对通过${skipNote}`);
    process.exit(0);
  } else if (totalSource !== totalMigrated) {
    console.warn(`\n⚠️  总行数不一致: 源 ${totalSource}, 迁移 ${totalMigrated}，请检查`);
    process.exit(1);
  } else {
    console.warn(`\n⚠️  行数一致但抽样比对发现差异，请检查上方告警`);
    process.exit(1);
  }
}

main().catch(async err => {
  console.error('❌ 迁移失败:', err);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
