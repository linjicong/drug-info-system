import { drizzle, type TiDBServerlessDatabase } from 'drizzle-orm/tidb-serverless';
import * as schema from './shared/schema';

type DB = TiDBServerlessDatabase<typeof schema>;

let _db: DB | null = null;

function getDb(): DB {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL environment variable is not set. Configure it in Vercel Dashboard or .env',
    );
  }
  _db = drizzle(url, { schema });
  return _db;
}

/**
 * 懒代理：避免构建时因 DATABASE_URL 未设置而失败。
 * 仅在运行时首次访问 db 的方法时才初始化连接。
 */
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const target = getDb();
    const value = Reflect.get(target, prop);
    return typeof value === 'function' ? value.bind(target) : value;
  },
}) as DB;
