import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // drizzle-kit 0.31 类型未导出 'tidb'，用 'mysql' dialect（TiDB 兼容 MySQL）+ mysql2 驱动连接
  dialect: 'mysql',
  schema: './src/storage/database/shared/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

