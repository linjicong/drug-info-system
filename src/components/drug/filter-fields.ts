import type { FilterFieldConfig } from './SearchCard';

/**
 * 药品筛选字段配置
 * gz / pubonln / merged 三个页面共用同一组筛选字段
 */
export const DRUG_FILTER_FIELDS: FilterFieldConfig[] = [
  {
    key: 'productName',
    label: '产品名称',
    type: 'input',
    placeholder: '输入产品名称',
  },
  {
    key: 'nationalDrugCode',
    label: '医保编码',
    type: 'input',
    placeholder: '输入医保编码',
  },
  {
    key: 'companyName',
    label: '生产企业',
    type: 'input',
    placeholder: '输入生产企业名称',
  },
  {
    key: 'minPacQuantity',
    label: '最小包装数量',
    type: 'input',
    placeholder: '输入最小包装数量',
  },
  {
    key: 'minMeasureUnit',
    label: '最小计量单位',
    type: 'input',
    placeholder: '输入最小计量单位',
  },
];
