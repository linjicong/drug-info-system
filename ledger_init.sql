-- 药品台账模块初始化 SQL (请在 Supabase SQL Editor 中执行)

-- 1. 创建用户追踪药品配置表
CREATE TABLE IF NOT EXISTS user_tracked_drugs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name VARCHAR(500) NOT NULL,
  national_drug_code VARCHAR(100),
  company_name VARCHAR(500),
  min_pac_quantity VARCHAR(50),  -- 有时会有特殊字符，如包装转换比，为了安全使用VARCHAR或NUMERIC
  min_measure_unit VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 为快速查询创建索引
CREATE INDEX IF NOT EXISTS idx_utd_product_company ON user_tracked_drugs(product_name, company_name);

-- 2. 创建药品每日台账汇总历史表
CREATE TABLE IF NOT EXISTS drug_daily_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tracked_drug_id UUID REFERENCES user_tracked_drugs(id) ON DELETE SET NULL,
  stat_date DATE NOT NULL,  -- 统计时间(只到天)
  product_name VARCHAR(500) NOT NULL,
  national_drug_code VARCHAR(100),
  dosform VARCHAR(100),
  company_name VARCHAR(500),
  spec TEXT,
  min_pac_quantity VARCHAR(50),
  min_pac_unit VARCHAR(50),
  min_measure_unit VARCHAR(50),
  drug_net_type VARCHAR(100),
  net_time VARCHAR(50),
  gpo_price NUMERIC(15, 4),        -- GPO挂网价格(元)
  provincial_price NUMERIC(15, 4), -- 省平台挂网价格(元)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 为快速查询创建索引
CREATE INDEX IF NOT EXISTS idx_ddl_stat_date ON drug_daily_ledgers(stat_date);
CREATE INDEX IF NOT EXISTS idx_ddl_product_name ON drug_daily_ledgers(product_name);
