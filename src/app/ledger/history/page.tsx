'use client';

import React, { useState, useEffect } from 'react';
import { Calendar as CalendarIcon, Download, Clock, Database, ChevronLeft, ChevronRight, RefreshCw, CalendarDays } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const LEDGER_HISTORY_QUERY_STORAGE_KEY = 'ledger-history-query-state';

type LedgerHistoryQueryState = {
  productName: string;
  nationalDrugCode: string;
  companyName: string;
  minPacQuantity: string;
  minMeasureUnit: string;
  startDate: string;
  endDate: string;
};

type LedgerHistoryApiQuery = LedgerHistoryQueryState;

const readLedgerHistoryQueryState = (): LedgerHistoryQueryState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(LEDGER_HISTORY_QUERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LedgerHistoryQueryState>;
    return {
      productName: typeof parsed.productName === 'string' ? parsed.productName : '',
      nationalDrugCode: typeof parsed.nationalDrugCode === 'string' ? parsed.nationalDrugCode : '',
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName : '',
      minPacQuantity: typeof parsed.minPacQuantity === 'string' ? parsed.minPacQuantity : '',
      minMeasureUnit: typeof parsed.minMeasureUnit === 'string' ? parsed.minMeasureUnit : '',
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : '',
      endDate: typeof parsed.endDate === 'string' ? parsed.endDate : '',
    };
  } catch {
    return null;
  }
};

export default function LedgerHistoryPage() {
  const today = new Date().toISOString().split('T')[0];
  const oneYearAgo = new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0];
  const persistedQueryState = readLedgerHistoryQueryState();

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [weeklyExporting, setWeeklyExporting] = useState(false);
  const [productName, setProductName] = useState(persistedQueryState?.productName ?? '');
  const [nationalDrugCode, setNationalDrugCode] = useState(persistedQueryState?.nationalDrugCode ?? '');
  const [companyName, setCompanyName] = useState(persistedQueryState?.companyName ?? '');
  const [minPacQuantity, setMinPacQuantity] = useState(persistedQueryState?.minPacQuantity ?? '');
  const [minMeasureUnit, setMinMeasureUnit] = useState(persistedQueryState?.minMeasureUnit ?? '');
  const [startDate, setStartDate] = useState(persistedQueryState?.startDate || oneYearAgo);
  const [endDate, setEndDate] = useState(persistedQueryState?.endDate || today);
  const [appliedQuery, setAppliedQuery] = useState<LedgerHistoryApiQuery>({
    productName: persistedQueryState?.productName ?? '',
    nationalDrugCode: persistedQueryState?.nationalDrugCode ?? '',
    companyName: persistedQueryState?.companyName ?? '',
    minPacQuantity: persistedQueryState?.minPacQuantity ?? '',
    minMeasureUnit: persistedQueryState?.minMeasureUnit ?? '',
    startDate: persistedQueryState?.startDate || oneYearAgo,
    endDate: persistedQueryState?.endDate || today,
  });
  
  // 分页状态
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 15;
  const [hasMounted, setHasMounted] = useState(false);

  const buildHistoryUrl = (query: LedgerHistoryApiQuery, pageNum: number, size: number) => {
    const url = new URL(window.location.origin + '/api/ledger/history');
    if (query.productName) url.searchParams.append('productName', query.productName);
    if (query.nationalDrugCode) url.searchParams.append('nationalDrugCode', query.nationalDrugCode);
    if (query.companyName) url.searchParams.append('companyName', query.companyName);
    if (query.minPacQuantity) url.searchParams.append('minPacQuantity', query.minPacQuantity);
    if (query.minMeasureUnit) url.searchParams.append('minMeasureUnit', query.minMeasureUnit);
    if (query.startDate) url.searchParams.append('startDate', query.startDate);
    if (query.endDate) url.searchParams.append('endDate', query.endDate);
    url.searchParams.append('page', pageNum.toString());
    url.searchParams.append('pageSize', size.toString());
    return url;
  };

  const fetchHistory = async (queryOverride?: LedgerHistoryApiQuery, pageOverride?: number) => {
    setLoading(true);
    try {
      const currentQuery: LedgerHistoryApiQuery = queryOverride ?? {
        productName,
        nationalDrugCode,
        companyName,
        minPacQuantity,
        minMeasureUnit,
        startDate,
        endDate,
      };
      const currentPage = pageOverride ?? page;
      const url = buildHistoryUrl(currentQuery, currentPage, pageSize);
      const res = await fetch(url.toString());
      const resData = await res.json();
      if (resData.success) {
        setData(resData.data);
        setTotal(resData.pagination?.total || 0);
        setAppliedQuery(currentQuery);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [page, startDate, endDate]); // 日期或页码改变时重新加载

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    if (!hasMounted) return;
    const timer = window.setTimeout(() => {
      if (page === 1) fetchHistory();
      else setPage(1);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [productName, nationalDrugCode, companyName, minPacQuantity, minMeasureUnit]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(LEDGER_HISTORY_QUERY_STORAGE_KEY, JSON.stringify({
      productName,
      nationalDrugCode,
      companyName,
      minPacQuantity,
      minMeasureUnit,
      startDate,
      endDate,
    }));
  }, [productName, nationalDrugCode, companyName, minPacQuantity, minMeasureUnit, startDate, endDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (page === 1) fetchHistory();
    else setPage(1); // 触发 effect
  };

  const handleReset = () => {
    const resetQuery: LedgerHistoryApiQuery = {
      productName: '',
      nationalDrugCode: '',
      companyName: '',
      minPacQuantity: '',
      minMeasureUnit: '',
      startDate: oneYearAgo,
      endDate: today,
    };

    setProductName('');
    setNationalDrugCode('');
    setCompanyName('');
    setMinPacQuantity('');
    setMinMeasureUnit('');
    setStartDate(oneYearAgo);
    setEndDate(today);
    if (page === 1) {
      fetchHistory(resetQuery, 1);
    } else {
      setPage(1);
    }
  };

  const exportToExcel = async () => {
    if (total === 0) return alert('当前没有可导出的数据');

    setExporting(true);
    try {
      const exportPageSize = 1000;
      const allRows: any[] = [];
      let currentPage = 1;
      let totalPages = 1;

      while (currentPage <= totalPages) {
        const url = buildHistoryUrl(appliedQuery, currentPage, exportPageSize);
        const res = await fetch(url.toString());
        const resData = await res.json();
        if (!resData.success) {
          throw new Error(resData.message || '导出查询失败');
        }

        const pageRows = Array.isArray(resData.data) ? resData.data : [];
        allRows.push(...pageRows);
        totalPages = Math.max(1, Number(resData.pagination?.totalPages || 1));
        currentPage += 1;
      }

      if (allRows.length === 0) {
        return alert('当前查询没有可导出的数据');
      }

      const exportData = allRows.map(item => ({
        '统计日期': item.stat_date,
        '产品名称': item.product_name,
        '医保编码': item.national_drug_code || '-',
        '剂型': item.dosform || '-',
        '生产企业': item.company_name || '-',
        '规格': item.spec || '-',
        '最小包装数量': item.min_pac_quantity || '-',
        '最小包装单位': item.min_pac_unit || '-',
        '最小计量单位': item.min_measure_unit || '-',
        '药品挂网类别': item.drug_net_type || '-',
        '挂网时间': item.net_time || '-',
        'GPO挂网价格(元)': item.gpo_price !== null ? Number(item.gpo_price).toFixed(2) : '-',
        '省平台挂网价格(元)': item.provincial_price !== null ? Number(item.provincial_price).toFixed(2) : '-'
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, '台账历史');
      XLSX.writeFile(workbook, `药品台账_${appliedQuery.startDate}_至_${appliedQuery.endDate}.xlsx`);
    } catch (e) {
      console.error(e);
      alert('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  /**
   * 计算指定日期范围内所有周一的日期
   * @returns 周一日期字符串数组 (YYYY-MM-DD)
   */
  const getMondaysInRange = (start: string, end: string): string[] => {
    const mondays: string[] = [];
    const startD = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');

    // 找到第一个 >= startD 的周一 (getDay: 0=Sun, 1=Mon)
    const current = new Date(startD);
    const dayOfWeek = current.getDay();
    if (dayOfWeek !== 1) {
      // 向后推到最近的周一
      const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
      current.setDate(current.getDate() + daysUntilMonday);
    }

    while (current <= endD) {
      const yyyy = current.getFullYear();
      const mm = String(current.getMonth() + 1).padStart(2, '0');
      const dd = String(current.getDate()).padStart(2, '0');
      mondays.push(`${yyyy}-${mm}-${dd}`);
      current.setDate(current.getDate() + 7);
    }

    return mondays;
  };

  /**
   * 导出每周一的台账数据（价格字段按日期透视展开）
   * 每个药品一行，每个周一的 GPO 和省平台价格各占一列
   */
  const exportWeeklyToExcel = async () => {
    // 1. 计算日期范围内的所有周一
    const mondays = getMondaysInRange(startDate, endDate);
    if (mondays.length === 0) {
      return alert('所选日期范围内没有周一，请扩大日期范围');
    }

    setWeeklyExporting(true);
    try {
      // 2. 调用 API 获取所有周一的台账数据
      const url = new URL(window.location.origin + '/api/ledger/history/export-weekly');
      url.searchParams.append('dates', mondays.join(','));
      if (productName) url.searchParams.append('productName', productName);
      if (nationalDrugCode) url.searchParams.append('nationalDrugCode', nationalDrugCode);
      if (companyName) url.searchParams.append('companyName', companyName);
      if (minPacQuantity) url.searchParams.append('minPacQuantity', minPacQuantity);
      if (minMeasureUnit) url.searchParams.append('minMeasureUnit', minMeasureUnit);

      const res = await fetch(url.toString());
      const resData = await res.json();

      if (!resData.success || !resData.data || resData.data.length === 0) {
        return alert('没有查询到周一的台账数据');
      }

      // 3. 按药品分组（使用 tracked_drug_id 作为唯一键，回退到 产品名称+企业 组合键）
      const drugMap = new Map<string, {
        product_name: string;
        national_drug_code: string;
        dosform: string;
        company_name: string;
        spec: string;
        min_pac_quantity: string;
        min_pac_unit: string;
        min_measure_unit: string;
        drug_net_type: string;
        valuesByDate: Record<string, { netTime: string | null; gpo: number | null; provincial: number | null }>;
      }>();

      for (const item of resData.data) {
        const key = item.tracked_drug_id || `${item.product_name}__${item.company_name || ''}`;
        if (!drugMap.has(key)) {
          drugMap.set(key, {
            product_name: item.product_name,
            national_drug_code: item.national_drug_code || '',
            dosform: item.dosform || '',
            company_name: item.company_name || '',
            spec: item.spec || '',
            min_pac_quantity: item.min_pac_quantity || '',
            min_pac_unit: item.min_pac_unit || '',
            min_measure_unit: item.min_measure_unit || '',
            drug_net_type: item.drug_net_type || '',
            valuesByDate: {},
          });
        }
        const drug = drugMap.get(key)!;
        drug.valuesByDate[item.stat_date] = {
          netTime: item.net_time || null,
          gpo: item.gpo_price,
          provincial: item.provincial_price,
        };
      }

      // 4. 从实际数据中提取有记录的日期列表（升序排列），没有数据的日期不输出
      const actualDatesSet = new Set<string>();
      for (const item of resData.data) {
        if (item.stat_date) actualDatesSet.add(item.stat_date);
      }
      const actualDates = Array.from(actualDatesSet).sort();

      // 5. 构建透视导出数据：基础信息列 + 仅有数据的日期价格列
      const diffFlagsByRow = Array.from(drugMap.values()).map(drug => {
        let hasNetTimeChanged = false;
        const changedDateSet = new Set<string>();

        for (let i = 1; i < actualDates.length; i++) {
          const prevDate = actualDates[i - 1];
          const currDate = actualDates[i];
          const prev = drug.valuesByDate[prevDate];
          const curr = drug.valuesByDate[currDate];

          const normalizeValue = (value: unknown) => {
            if (value === null || value === undefined) return '';
            return String(value).trim();
          };

          const prevNetTime = normalizeValue(prev?.netTime);
          const currNetTime = normalizeValue(curr?.netTime);
          if (prevNetTime !== currNetTime) {
            hasNetTimeChanged = true;
          }

          const isPriceDifferent = (a: number | null | undefined, b: number | null | undefined) => {
            if (a === null || a === undefined) return b !== null && b !== undefined;
            if (b === null || b === undefined) return true;
            return Number(a) !== Number(b);
          };

          if (isPriceDifferent(prev?.gpo, curr?.gpo) || isPriceDifferent(prev?.provincial, curr?.provincial)) {
            changedDateSet.add(currDate);
          }
        }

        return {
          hasNetTimeChanged,
          changedDateSet,
        };
      });

      const exportData = Array.from(drugMap.values()).map(drug => {
        const latestDateWithData = [...actualDates].reverse().find(date => drug.valuesByDate[date]);
        const displayNetTime = latestDateWithData
          ? (drug.valuesByDate[latestDateWithData]?.netTime || '-')
          : '-';

        const row: Record<string, any> = {
          '产品名称': drug.product_name,
          '医保编码': drug.national_drug_code || '-',
          '剂型': drug.dosform || '-',
          '生产企业': drug.company_name || '-',
          '规格': drug.spec || '-',
          '最小包装数量': drug.min_pac_quantity || '-',
          '最小包装单位': drug.min_pac_unit || '-',
          '最小计量单位': drug.min_measure_unit || '-',
          '药品挂网类别': drug.drug_net_type || '-',
          '挂网时间': displayNetTime,
        };

        // 仅遍历实际有数据的日期
        for (const date of actualDates) {
          const dateLabel = date.replace(/-/g, '/');
          const priceData = drug.valuesByDate[date];
          row[`GPO挂网价格(元)-${dateLabel}`] =
            priceData?.gpo !== null && priceData?.gpo !== undefined
              ? Number(priceData.gpo).toFixed(2)
              : '-';
          row[`省平台挂网价格(元)-${dateLabel}`] =
            priceData?.provincial !== null && priceData?.provincial !== undefined
              ? Number(priceData.provincial).toFixed(2)
              : '-';
        }

        return row;
      });

      // 5. 生成 Excel 文件
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      const yellowFillStyle = {
        fill: {
          patternType: 'solid',
          fgColor: { rgb: 'FFFDE68A' },
        },
      };

      // 挂网时间如果任意一周变化，标黄该单元格
      const netTimeHeaderIndex = Object.keys(exportData[0] || {}).indexOf('挂网时间');
      if (netTimeHeaderIndex >= 0) {
        for (let rowIdx = 0; rowIdx < diffFlagsByRow.length; rowIdx++) {
          if (!diffFlagsByRow[rowIdx].hasNetTimeChanged) continue;
          const cellAddress = XLSX.utils.encode_cell({ r: rowIdx + 1, c: netTimeHeaderIndex });
          const currentCell = worksheet[cellAddress];
          if (currentCell) {
            currentCell.s = { ...(currentCell.s || {}), ...yellowFillStyle };
          }
        }
      }

      // 价格列若较上周变化，则当前周对应单元格标黄
      for (let rowIdx = 0; rowIdx < diffFlagsByRow.length; rowIdx++) {
        const changedDates = diffFlagsByRow[rowIdx].changedDateSet;
        for (const date of changedDates) {
          const dateLabel = date.replace(/-/g, '/');
          const gpoHeader = `GPO挂网价格(元)-${dateLabel}`;
          const provincialHeader = `省平台挂网价格(元)-${dateLabel}`;
          const headers = Object.keys(exportData[rowIdx] || {});
          const gpoColIndex = headers.indexOf(gpoHeader);
          const provincialColIndex = headers.indexOf(provincialHeader);

          if (gpoColIndex >= 0) {
            const gpoCellAddress = XLSX.utils.encode_cell({ r: rowIdx + 1, c: gpoColIndex });
            const gpoCell = worksheet[gpoCellAddress];
            if (gpoCell) {
              gpoCell.s = { ...(gpoCell.s || {}), ...yellowFillStyle };
            }
          }

          if (provincialColIndex >= 0) {
            const provincialCellAddress = XLSX.utils.encode_cell({ r: rowIdx + 1, c: provincialColIndex });
            const provincialCell = worksheet[provincialCellAddress];
            if (provincialCell) {
              provincialCell.s = { ...(provincialCell.s || {}), ...yellowFillStyle };
            }
          }
        }
      }

      XLSX.utils.book_append_sheet(workbook, worksheet, '周一台账');
      XLSX.writeFile(workbook, `药品台账_周一数据_${startDate}_至_${endDate}.xlsx`);
    } catch (e) {
      console.error(e);
      alert('导出周一台账数据失败');
    } finally {
      setWeeklyExporting(false);
    }
  };

  // 手动触发数据生成跑批
  const handleGenerateSnapshot = async () => {
    if (!confirm('确定要在此时手动触发生成当天的台账快照吗？(如果今天已有生成的数据，会被覆盖)')) return;
    
    try {
      setLoading(true);
      const res = await fetch('/api/ledger/manual-trigger', { method: 'POST' });
      const resData = await res.json();
      alert(resData.message || '执行结束');
      if (resData.success) {
        setPage(1);
        fetchHistory();
      }
    } catch (e) {
      alert('执行请求失败');
    } finally {
      setLoading(false);
    }
  };
  
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="min-h-screen bg-slate-50/50 p-6 flex flex-col">
      <div className="max-w-7xl mx-auto space-y-6 w-full flex-1 flex flex-col">
        
        {/* Header Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center border border-blue-100/50 shrink-0">
              <Database className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">历史台账库</h1>
              <p className="text-slate-500 mt-1 text-sm">查询您监控的药品每天汇总的历史挂网数据及价格变化。</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
            <button 
              onClick={handleGenerateSnapshot}
              className="px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 border border-indigo-200"
            >
              <Clock className="h-4 w-4" />
              手动生成今日台账
            </button>
            <button 
              onClick={exportToExcel}
              disabled={exporting}
              className="px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 border border-emerald-200 disabled:opacity-60"
            >
              {exporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? '导出中...' : '导出当前查询'}
            </button>
            <button 
              onClick={exportWeeklyToExcel}
              disabled={weeklyExporting}
              className="px-4 py-2 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-xl text-sm font-medium transition-colors flex items-center gap-2 border border-amber-200 disabled:opacity-60"
            >
              {weeklyExporting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
              {weeklyExporting ? '导出中...' : '每周一导出'}
            </button>
          </div>
        </div>

        {/* Filter Section */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
          <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-4">
            <div className="w-full sm:w-[260px]">
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="产品名称"
                className="px-4 py-2.5 w-full border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="w-full sm:w-[220px]">
              <input
                type="text"
                value={nationalDrugCode}
                onChange={(e) => setNationalDrugCode(e.target.value)}
                placeholder="医保编码"
                className="px-4 py-2.5 w-full border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="w-full sm:w-[260px]">
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="生产企业"
                className="px-4 py-2.5 w-full border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="w-full sm:w-[180px]">
              <input
                type="text"
                value={minPacQuantity}
                onChange={(e) => setMinPacQuantity(e.target.value)}
                placeholder="最小包装数量"
                className="px-4 py-2.5 w-full border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="w-full sm:w-[180px]">
              <input
                type="text"
                value={minMeasureUnit}
                onChange={(e) => setMinMeasureUnit(e.target.value)}
                placeholder="最小计量单位"
                className="px-4 py-2.5 w-full border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white"
              />
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <CalendarIcon className="h-4 w-4 text-slate-400" />
                </div>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white text-slate-600"
                />
              </div>
              <span className="text-slate-400 text-sm">至</span>
              <div className="relative">
                <input 
                  type="date" 
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="pl-4 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all text-sm bg-slate-50 focus:bg-white text-slate-600"
                />
              </div>
            </div>

            <button type="submit" className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium shadow-sm w-full md:w-auto">
              筛选
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium shadow-sm w-full md:w-auto"
            >
              重置
            </button>
          </form>
        </div>

        {/* Data Table */}
        <div className="bg-white border border-slate-100 rounded-2xl shadow-sm flex flex-col flex-1 overflow-hidden">
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left whitespace-nowrap min-w-max">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">统计日期</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">产品名称</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">医保编码</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">生产企业</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">规格/剂型</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">包装</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-slate-500 tracking-wider">挂网类别</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-blue-600 tracking-wider">GPO价 (元)</th>
                  <th className="px-5 py-3.5 text-xs font-semibold text-blue-600 tracking-wider">省平台价 (元)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-20 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <RefreshCw className="h-8 w-8 animate-spin text-slate-300 mb-4" />
                        <p>正在加载台账数据...</p>
                      </div>
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-20 text-center text-slate-500">
                      没有查询到匹配的台账历史记录
                    </td>
                  </tr>
                ) : (
                  data.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center px-2 py-1 rounded bg-slate-100 text-slate-600 text-xs font-medium">
                          {item.stat_date}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-slate-800 text-sm max-w-[200px] truncate" title={item.product_name}>
                          {item.product_name}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-xs font-mono text-slate-500">{item.national_drug_code || '-'}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-sm text-slate-600 max-w-[200px] truncate" title={item.company_name}>
                          {item.company_name || '-'}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-sm text-slate-800">{item.spec || '-'}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{item.dosform || '-'}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-sm text-slate-600">
                          {item.min_pac_quantity || '?'} {item.min_measure_unit || ''}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="text-sm text-slate-600">{item.drug_net_type || '-'}</div>
                        <div className="text-xs text-slate-400">{item.net_time || '-'}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-800">
                          {item.gpo_price !== null ? <span className="text-blue-600">¥ {Number(item.gpo_price).toFixed(2)}</span> : '-'}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-slate-800">
                          {item.provincial_price !== null ? <span className="text-blue-600">¥ {Number(item.provincial_price).toFixed(2)}</span> : '-'}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* Pagination */}
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/30">
            <div className="text-sm text-slate-500">
              共 <span className="font-medium text-slate-800">{total}</span> 条记录
              {totalPages > 0 && `，第 ${page} / ${totalPages} 页`}
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50 disabled:bg-slate-50 transition-colors shadow-sm"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button 
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || totalPages === 0}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50 disabled:bg-slate-50 transition-colors shadow-sm"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

