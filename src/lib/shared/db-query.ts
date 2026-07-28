import { count, type SQL } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { db } from '@/storage/database/db';

/**
 * 创建行规整函数：drizzle decimal 字段(string) 转 number（保持与原 Supabase numeric 行为一致）
 * emptyValue 决定空值语义：gz/pubonln 为 undefined（默认），merged 为 null
 */
export function createRowNormalizer<T>(
  decimalFields: string[],
  options?: { emptyValue?: null },
): (row: Record<string, unknown>) => T {
  const emptyValue = options?.emptyValue;
  return (row: Record<string, unknown>): T => {
    const patch: Record<string, unknown> = {};
    for (const field of decimalFields) {
      patch[field] = row[field] != null ? Number(row[field]) : emptyValue;
    }
    return { ...row, ...patch } as unknown as T;
  };
}

/**
 * 分页查询：并行查询数据与总数
 */
export async function getPagedList<T>(params: {
  table: MySqlTable;
  where: SQL | undefined;
  orderBy: SQL;
  page: number;
  pageSize: number;
  normalizeRow: (row: Record<string, unknown>) => T;
}): Promise<{ data: T[]; total: number }> {
  const { table, where, orderBy, page, pageSize, normalizeRow } = params;
  const offset = (page - 1) * pageSize;

  // 并行查询数据与总数
  const [dataRows, countRows] = await Promise.all([
    db
      .select()
      .from(table)
      .where(where)
      .orderBy(orderBy)
      .offset(offset)
      .limit(pageSize),
    db
      .select({ count: count() })
      .from(table)
      .where(where),
  ]);

  return {
    data: (dataRows as Record<string, unknown>[]).map(normalizeRow),
    total: Number(countRows[0]?.count ?? 0),
  };
}

/**
 * 分批获取所有数据（导出场景）
 */
export async function fetchAllInBatches<T>(params: {
  table: MySqlTable;
  where: SQL | undefined;
  orderBy: SQL;
  normalizeRow: (row: Record<string, unknown>) => T;
  batchSize?: number;
}): Promise<T[]> {
  const { table, where, orderBy, normalizeRow, batchSize = 1000 } = params;
  const allData: T[] = [];
  let offset = 0;

  // 分批获取所有数据
  while (true) {
    const rows = await db
      .select()
      .from(table)
      .where(where)
      .orderBy(orderBy)
      .offset(offset)
      .limit(batchSize);

    if (rows.length === 0) break;

    allData.push(...(rows as Record<string, unknown>[]).map(normalizeRow));
    offset += batchSize;
    if (rows.length < batchSize) break;
  }

  return allData;
}
