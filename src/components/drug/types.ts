/**
 * 药品模块共用类型定义
 * 包含分页信息、抓取进度、调度器配置以及两个模块的药品数据接口
 */

/** 分页信息 */
export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 抓取进度 */
export interface FetchProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  currentPage: number;
  totalPages: number;
  processedCount: number;
  totalCount: number;
  newCount: number;
  updateCount: number;
  startTime: number | null;
  endTime: number | null;
  error: string | null;
}

/** 调度器配置 */
export interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  isRunning: boolean;
  runningStatus?: 'idle' | 'running';
  latestDataTime?: string | null;
  latestLog?: {
    startTime: string;
    endTime: string | null;
    status: string;
    totalCount: number;
    newCount: number;
    updateCount: number;
    durationSeconds: number | null;
  } | null;
}

/** 广州药品采购平台 - 药品信息接口（23个API字段） */
export interface DrugInfo {
  id: string;
  /** 商品ID（与procurecatalog_id组成复合唯一键） */
  goods_id: string;
  /** 采购目录ID（与goods_id组成复合唯一键） */
  procurecatalog_id: string;
  /** 药品通用名 */
  product_name: string;
  /** 药品商品名 */
  goods_name?: string;
  /** 生产企业 */
  company_name_sc?: string;
  /** 剂型名称 */
  medicinemodel?: string;
  /** 规格（包装单位） */
  unit?: string;
  /** 最小规格 */
  min_unit?: string;
  /** 规格包装 */
  outlook?: string;
  /** 规格ID */
  unit_id?: string;
  /** 数量 */
  factor?: number;
  /** 规格包装单位数值 */
  outlook_unit?: number;
  /** 包装单位参考价格(元) */
  bid_price?: number;
  /** 最小制剂单位参考价格(元) */
  min_unit_price?: number;
  /** 最高挂网价格(元) */
  max_listing_price?: number;
  /** 医保编码 */
  national_drug_code?: string;
  /** 采购方式 */
  purchase_type?: number;
  /** 甲乙类（0-非医保，1-甲类，2-乙类） */
  medicare_type?: number;
  /** 药品挂网类别 */
  source_type?: string;
  /** 材料名称 */
  material_name?: string;
  /** 隐藏价格标志 */
  hidden_price_flag?: number;
  /** 活跃分区标志 */
  subarea_flag?: number;
  /** 商品状态 */
  is_out_stock?: number;
  /** 费率 */
  fs_rate?: number;
  /** 挂网时间 */
  net_time?: string;
  /** 价格形成时间 */
  price_formation_time?: string;
  /** 系统字段 */
  created_at: string;
  updated_at?: string;
}

/** 广东省医保局 - 挂网药品信息接口 */
export interface PubonlnDrugInfo {
  id: string;
  drug_id?: number;
  gw_active?: string;
  genname: string;
  trade_name?: string;
  reg_dosform_name?: string;
  dosform_name?: string;
  reg_spec_name?: string;
  pacmatl?: string;
  specification_properties?: string;
  listing_license_holder?: string;
  prodentp_name?: string;
  dcla_entp_name?: string;
  aprvno?: string;
  convrat?: string;
  minunt_name?: string;
  minpac_name?: string;
  min_pac_pubonln_pric?: number;
  pubonln_time?: string;
  drug_class?: string;
  policy_att?: string;
  drug_select_type?: string;
  quality_lv?: string;
  is_national_basic_drug?: string;
  is_shortage_drug?: string;
  jyl_no?: string;
  jyl_category?: string;
  dishonesty_lv?: string;
  dishonesty_stas?: string;
  price_risk?: string;
  drug_code?: string;
  zc_spt_id?: string;
  dcla_entp_uscc?: string;
  formation_mode?: string;
  stop_pubonln?: number;
  exist_pubonln_pric?: number;
  remark?: string;
  created_at: string;
  updated_at?: string;
}

/** 药品模块 API 配置 */
export interface DrugModuleApiConfig {
  /** 药品列表查询接口 */
  drugsApi: string;
  /** 调度器配置接口 */
  schedulerApi: string;
  /** 抓取进度查询接口 */
  progressApi: string;
  /** 触发抓取接口 */
  fetchApi: string;
  /** 导出接口 */
  exportApi: string;
  /** 默认导出文件名 */
  defaultExportFilename: string;
}

/** 数据来源标识 */
export type DrugSource = 'gd_only' | 'gz_only' | 'both';

/**
 * 整合药品数据 - 统一字段接口
 * 合并广东医保挂网药品与广州采购平台药品数据，按统一字段名展示
 */
export interface MergedDrugInfo {
  /** 唯一标识（合并key） */
  id: string;
  /** 数据来源标识：gd_only=仅广东医保, gz_only=仅广州采购, both=两源均有 */
  source: DrugSource;

  // ─── 公共字段（统一名称） ───
  /** 产品名称（通用名） */
  product_name: string;
  /** 医保编码 */
  national_drug_code?: string;
  /** 剂型 */
  dosform?: string;
  /** 生产企业 */
  company_name?: string;
  /** 规格 */
  spec?: string;
  /** 最小包装数量 */
  min_pac_quantity?: string | number;
  /** 最小包装单位 */
  min_pac_unit?: string;
  /** 最小计量单位 */
  min_measure_unit?: string;
  /** 药品挂网类别 */
  drug_net_type?: string;
  /** 挂网时间 */
  net_time?: string;
  /** 医保甲乙类（统一为字符串） */
  medicare_type_label?: string;
  /** 包装材料 */
  package_material?: string;

  // ─── 价格字段（按来源区分） ───
  /** 省平台挂网价格（广东医保来源） */
  gd_price?: number;
  /** GPO挂网价格（广州采购平台来源，中标价） */
  gz_bid_price?: number;
  /** GPO挂网最小规格价格（广州采购平台来源） */
  gz_min_unit_price?: number;
}
