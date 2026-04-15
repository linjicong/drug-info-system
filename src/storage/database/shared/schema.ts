import { sql } from "drizzle-orm"
import { pgTable, serial, timestamp, varchar, text, numeric, jsonb, index, integer, boolean } from "drizzle-orm/pg-core"


export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 统一的调度器配置表（支持多数据源）
export const unifiedSchedulerConfig = pgTable("unified_scheduler_config", {
	id: serial().notNull().primaryKey(),
  
  // 数据源标识：'gz_drug' 或 'gd_pubonln'
  source: varchar("source", { length: 50 }).notNull().unique(),
  
  // 是否启用定时抓取
  enabled: boolean("enabled").default(false).notNull(),
  
  // 抓取间隔（分钟）
  interval_minutes: integer("interval_minutes").default(60).notNull(),
  
  // 下次执行时间
  next_run_at: timestamp("next_run_at", { withTimezone: true }),
  
  // 上次执行时间
  last_run_at: timestamp("last_run_at", { withTimezone: true }),
  
  // 上次执行状态
  last_run_status: varchar("last_run_status", { length: 50 }),
  
  // 运行状态：idle, running
  running_status: varchar("running_status", { length: 20 }).default('idle').notNull(),
  
  // 更新时间
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 抓取日志表
export const scrapeLog = pgTable(
  "scrape_log",
  {
    id: serial().notNull().primaryKey(),
    
    // 数据源标识：'gz_drug' 或 'gd_pubonln'
    source: varchar("source", { length: 50 }).notNull(),
    
    // 抓取类型：'manual' 或 'scheduled'
    scrape_type: varchar("scrape_type", { length: 20 }).notNull(),
    
    // 状态：'running', 'success', 'failed'
    status: varchar("status", { length: 20 }).notNull().default('running'),
    
    // 开始时间
    start_time: timestamp("start_time", { withTimezone: true }).notNull().defaultNow(),
    
    // 结束时间
    end_time: timestamp("end_time", { withTimezone: true }),
    
    // 耗时（秒）
    duration_seconds: integer("duration_seconds"),
    
    // 处理总数
    total_count: integer("total_count").default(0),
    
    // 新增数量
    new_count: integer("new_count").default(0),
    
    // 更新数量
    update_count: integer("update_count").default(0),
    
    // 错误信息
    error_message: text("error_message"),
    
    // 创建时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_scrape_log_source").on(table.source),
    index("idx_scrape_log_start_time").on(table.start_time),
  ]
);

// 定时任务配置表（保留兼容）
export const schedulerConfig = pgTable("scheduler_config", {
	id: serial().notNull().primaryKey(),
  
  // 是否启用定时抓取
  enabled: boolean("enabled").default(false).notNull(),
  
  // 抓取间隔（分钟）
  interval_minutes: integer("interval_minutes").default(60).notNull(),
  
  // 下次执行时间
  next_run_at: timestamp("next_run_at", { withTimezone: true }),
  
  // 上次执行时间
  last_run_at: timestamp("last_run_at", { withTimezone: true }),
  
  // 上次执行状态
  last_run_status: varchar("last_run_status", { length: 50 }),
  
  // 更新时间
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 挂网药品信息表 - 广东医保服务平台挂网公示
export const pubonlnDrugInfo = pgTable(
  "pubonln_drug_info",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    
    // ============ API 返回字段 ============
    
    // 药品ID
    drug_id: integer("drug_id"),
    
    // 全省交易状态（活跃区）
    gw_active: varchar("gw_active", { length: 50 }),
    
    // 注册名称（通用名）
    genname: varchar("genname", { length: 500 }).notNull(),
    
    // 商品名
    trade_name: varchar("trade_name", { length: 200 }),
    
    // 注册剂型
    reg_dosform_name: varchar("reg_dosform_name", { length: 100 }),
    
    // 剂型名称
    dosform_name: varchar("dosform_name", { length: 100 }),
    
    // 注册规格
    reg_spec_name: text("reg_spec_name"),
    
    // 包装材质
    pacmatl: text("pacmatl"),
    
    // 规格属性
    specification_properties: text("specification_properties"),
    
    // 上市许可持有人
    listing_license_holder: varchar("listing_license_holder", { length: 500 }),
    
    // 生产企业
    prodentp_name: varchar("prodentp_name", { length: 500 }),
    
    // 申报企业
    dcla_entp_name: varchar("dcla_entp_name", { length: 500 }),
    
    // 批准文号/注册证号
    aprvno: varchar("aprvno", { length: 100 }),
    
    // 最小包装数量（转换比）
    convrat: varchar("convrat", { length: 50 }),
    
    // 最小计量单位
    minunt_name: varchar("minunt_name", { length: 50 }),
    
    // 最小包装单位
    minpac_name: varchar("minpac_name", { length: 50 }),
    
    // 挂网价格(元)（包装）
    min_pac_pubonln_pric: numeric("min_pac_pubonln_pric", { precision: 15, scale: 4 }),
    
    // 挂网时间
    pubonln_time: varchar("pubonln_time", { length: 50 }),
    
    // ============ 全省统一政策属性 ============
    
    // 药品分类
    drug_class: varchar("drug_class", { length: 100 }),
    
    // 政策属性
    policy_att: varchar("policy_att", { length: 100 }),
    
    // 政策类别
    drug_select_type: varchar("drug_select_type", { length: 100 }),
    
    // 质量层次
    quality_lv: varchar("quality_lv", { length: 100 }),
    
    // 是否国家基药
    is_national_basic_drug: varchar("is_national_basic_drug", { length: 50 }),
    
    // 是否短缺易短缺药品
    is_shortage_drug: varchar("is_shortage_drug", { length: 50 }),
    
    // 编号
    jyl_no: varchar("jyl_no", { length: 50 }),
    
    // 2025版甲乙类
    jyl_category: varchar("jyl_category", { length: 50 }),
    
    // ============ 信用评价信息 ============
    
    // 失信等级
    dishonesty_lv: varchar("dishonesty_lv", { length: 50 }),
    
    // 是否修复
    dishonesty_stas: varchar("dishonesty_stas", { length: 50 }),
    
    // 价格风险提示
    price_risk: varchar("price_risk", { length: 100 }),
    
    // ============ 其他信息 ============
    
    // 国家医保代码
    drug_code: varchar("drug_code", { length: 100 }),
    
    // 招采系统ID
    zc_spt_id: varchar("zc_spt_id", { length: 100 }),
    
    // 申报企业统一社会信用代码
    dcla_entp_uscc: varchar("dcla_entp_uscc", { length: 50 }),
    
    // 形成方式
    formation_mode: varchar("formation_mode", { length: 50 }),
    
    // 是否暂停挂网、已撤网
    stop_pubonln: integer("stop_pubonln").default(0),
    
    // 是否存在挂网价格
    exist_pubonln_pric: integer("exist_pubonln_pric").default(0),
    
    // 备注
    remark: text("remark"),
    
    // ============ 系统字段 ============
    
    // 创建时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    
    // 更新时间
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_pubonln_drug_info_genname").on(table.genname),
    index("idx_pubonln_drug_info_listing_license_holder").on(table.listing_license_holder),
    index("idx_pubonln_drug_info_drug_code").on(table.drug_code),
  ]
);

// 药品信息表 - 完全匹配API返回字段（共23个API字段）
// 字段说明参考广州药品采购平台 API 返回
export const drugInfo = pgTable(
  "drug_info",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    
    // ============ API 返回字段 ============
    
    // 商品ID（无唯一约束）
    goods_id: varchar("goods_id", { length: 50 }).notNull(),
    
    // 药品通用名
    product_name: varchar("product_name", { length: 500 }).notNull(),
    
    // 药品商品名
    goods_name: varchar("goods_name", { length: 500 }),
    
    // 生产企业
    company_name_sc: varchar("company_name_sc", { length: 500 }),
    
    // 剂型名称（如：注射剂、片剂、胶囊剂等）
    medicinemodel: varchar("medicinemodel", { length: 200 }),
    
    // 规格（包装单位，如：瓶、盒、支等）
    unit: varchar("unit", { length: 50 }),
    
    // 最小规格（如：片、粒、袋等）
    min_unit: varchar("min_unit", { length: 50 }),
    
    // 规格包装（详细规格描述）
    outlook: text("outlook"),
    
    // 规格ID
    unit_id: varchar("unit_id", { length: 50 }),
    
    // 数量（包装内最小单位数量）
    factor: integer("factor"),
    
    // 规格包装单位数值
    outlook_unit: numeric("outlook_unit", { precision: 15, scale: 4 }),
    
    // 包装单位参考价格(元)
    bid_price: numeric("bid_price", { precision: 15, scale: 4 }),
    
    // 最小制剂单位参考价格(元)
    min_unit_price: numeric("min_unit_price", { precision: 15, scale: 4 }),
    
    // 最高挂网价格(元)
    max_listing_price: numeric("max_listing_price", { precision: 15, scale: 4 }),
    
    // 医保编码
    national_drug_code: varchar("national_drug_code", { length: 100 }),
    
    // 采购目录ID（与goods_id组成复合唯一键）
    procurecatalog_id: varchar("procurecatalog_id", { length: 50 }).notNull(),
    
    // 采购方式（1-集中采购，2-其他）
    purchase_type: integer("purchase_type"),
    
    // 甲乙类（0-非医保，1-甲类，2-乙类）
    medicare_type: integer("medicare_type"),
    
    // 药品挂网类别（如：非集采、省采中选等）
    source_type: varchar("source_type", { length: 100 }),
    
    // 材料名称
    material_name: text("material_name"),
    
    // 隐藏价格标志（0-显示，1-隐藏）
    hidden_price_flag: integer("hidden_price_flag").default(0),
    
    // 活跃分区标志
    subarea_flag: integer("subarea_flag").default(0),
    
    // 商品状态（0-正常，1-停用）
    is_out_stock: integer("is_out_stock").default(0),
    
    // 费率
    fs_rate: numeric("fs_rate", { precision: 10, scale: 4 }),
    
    // 挂网时间
    net_time: varchar("net_time", { length: 50 }),
    
    // 价格形成时间
    price_formation_time: varchar("price_formation_time", { length: 50 }),
    
    // ============ 系统字段 ============
    
    // 创建时间
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    
    // 更新时间
    updated_at: timestamp("updated_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_drug_info_product_name").on(table.product_name),
    index("idx_drug_info_company_name").on(table.company_name_sc),
    index("idx_drug_info_source_type").on(table.source_type),
  ]
);
