'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Edit, Upload, RefreshCw, HardDrive, LayoutGrid, FileDown, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx';

const LEDGER_TRACK_QUERY_STORAGE_KEY = 'ledger-track-query-state';

type LedgerTrackQueryState = {
  productName: string;
  companyName: string;
  nationalDrugCode: string;
};

const readLedgerTrackQueryState = (): LedgerTrackQueryState | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(LEDGER_TRACK_QUERY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LedgerTrackQueryState>;
    return {
      productName: typeof parsed.productName === 'string' ? parsed.productName : '',
      companyName: typeof parsed.companyName === 'string' ? parsed.companyName : '',
      nationalDrugCode: typeof parsed.nationalDrugCode === 'string' ? parsed.nationalDrugCode : '',
    };
  } catch {
    return null;
  }
};

export default function TrackedDrugsPage() {
  const persistedQueryState = readLedgerTrackQueryState();

  const [drugs, setDrugs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);

  // 分页状态
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  // 搜索条件状态
  const [searchProductName, setSearchProductName] = useState(persistedQueryState?.productName ?? '');
  const [searchCompanyName, setSearchCompanyName] = useState(persistedQueryState?.companyName ?? '');
  const [searchDrugCode, setSearchDrugCode] = useState(persistedQueryState?.nationalDrugCode ?? '');
  const [onlyShowUnmatched, setOnlyShowUnmatched] = useState(false);
  const [unmatchedTotal, setUnmatchedTotal] = useState(0);

  const [form, setForm] = useState({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' });
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 与汇总页一致：跳过首次渲染，避免与分页 effect 重复请求 */
  const autoSearchInitializedRef = useRef(false);

  // 构建查询参数
  const buildQueryParams = (targetPage: number, targetPageSize: number) => {
    const params = new URLSearchParams();
    params.append('page', String(targetPage));
    params.append('pageSize', String(targetPageSize));
    if (searchProductName.trim()) params.append('productName', searchProductName.trim());
    if (searchCompanyName.trim()) params.append('companyName', searchCompanyName.trim());
    if (searchDrugCode.trim()) params.append('nationalDrugCode', searchDrugCode.trim());
    if (onlyShowUnmatched) params.append('onlyUnmatched', 'true');
    return params.toString();
  };

  // 获取监控药品列表（支持分页和搜索）
  const fetchDrugs = async (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true);
    try {
      const queryString = buildQueryParams(targetPage, targetPageSize);
      const res = await fetch(`/api/ledger/tracked-drugs?${queryString}`);
      const data = await res.json();
      if (data.success) {
        setDrugs(data.data);
        setPage(data.pagination.page);
        setPageSize(data.pagination.pageSize);
        setTotal(data.pagination.total);
        setTotalPages(data.pagination.totalPages);
        setUnmatchedTotal(data.summary?.unmatchedTotal || 0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 手动刷新：当前已在第 1 页时直接请求；否则先回到第 1 页由分页 effect 拉取
  const handleRefreshList = () => {
    if (page === 1) fetchDrugs(1, pageSize);
    else setPage(1);
  };

  // 重置搜索条件（会触发下方「条件变化」effect 自动查询）
  const handleResetSearch = () => {
    setSearchProductName('');
    setSearchCompanyName('');
    setSearchDrugCode('');
  };

  // 分页 / 每页条数变化时加载（与药品汇总页一致）
  useEffect(() => {
    fetchDrugs(page, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  // 查询条件变化时自动查询：非第 1 页先重置页码，否则直接请求
  useEffect(() => {
    if (!autoSearchInitializedRef.current) {
      autoSearchInitializedRef.current = true;
      return;
    }
    if (page !== 1) {
      setPage(1);
      return;
    }
    fetchDrugs(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchProductName, searchCompanyName, searchDrugCode, onlyShowUnmatched]);

  // 记忆查询条件（菜单切换后返回时恢复）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(LEDGER_TRACK_QUERY_STORAGE_KEY, JSON.stringify({
      productName: searchProductName,
      companyName: searchCompanyName,
      nationalDrugCode: searchDrugCode,
    }));
  }, [searchProductName, searchCompanyName, searchDrugCode]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const url = '/api/ledger/tracked-drugs' + (isEditing ? `?id=${form.id}` : '');
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) {
        setForm({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' });
        setIsEditing(false);
        fetchDrugs();
      } else {
        alert('保存失败：' + data.message);
      }
    } catch (e) {
      alert('网络错误');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该追踪记录吗？')) return;
    try {
      const res = await fetch(`/api/ledger/tracked-drugs?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        fetchDrugs();
      }
    } catch (e) {
      alert('网络错误');
    }
  };

  const handleEdit = (item: any) => {
    setForm(item);
    setIsEditing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 触发Excel导入逻辑
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // 转化为JSON（表头为属性名）
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet);

        // 映射属性名称 -> 我们的系统字段名称 (根据中文标题)
        const mappedData = json.map(row => ({
          product_name: row['产品名称'] || '',
          national_drug_code: row['医保编码'] || '',
          company_name: row['生产企业'] || '',
          min_pac_quantity: row['最小包装数量'] ? String(row['最小包装数量']) : '',
          min_measure_unit: row['最小计量单位'] || ''
        })).filter(row => row.product_name !== ''); // 忽略空行

        if (mappedData.length === 0) {
          alert('未在Excel中找到有效数据，请检查列头名称是否正确匹配。');
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // 调用批量新建 API
        const res = await fetch('/api/ledger/tracked-drugs?replace=true', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mappedData)
        });
        const apiData = await res.json();
        if (apiData.success) {
          alert(`成功导入 ${apiData.count} 条记录！`);
          fetchDrugs();
        } else {
          alert('导入失败：' + apiData.message);
        }
      } catch (error) {
        console.error(error);
        alert('解析Excel文件出错');
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleDownloadTemplate = () => {
    const templateData = [{
      '产品名称': '阿莫西林胶囊',
      '医保编码': 'XC123456789 (没填请留空)',
      '生产企业': '某某制药厂',
      '最小包装数量': '10',
      '最小计量单位': '盒'
    }];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '导入模板');
    XLSX.writeFile(workbook, '药品监控配置导入模板.xlsx');
  };

  const handleNew = () => {
    setForm({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' });
    setIsEditing(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <LayoutGrid className="text-blue-600 h-6 w-6" />
              药品监控台账
            </h1>
            <p className="text-slate-500 mt-1 text-sm">管理和配置需要每日关注且提取挂网价格和信息的药品清单。</p>
          </div>
          <div className="mt-4 md:mt-0 flex space-x-3">
            <button
              onClick={handleDownloadTemplate}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors flex items-center gap-2 text-sm font-medium shadow-sm"
            >
              <FileDown className="h-4 w-4" />
              下载模板
            </button>
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-4 py-2 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-colors flex items-center gap-2 text-sm font-medium shadow-sm"
            >
              {isUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isUploading ? '正在导入...' : 'Excel导入配置'}
            </button>
          </div>
        </div>

        {/* 第一段：搜索区（条件变更自动查询，与药品汇总页行为一致） */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <p className="text-xs text-slate-500 mb-3">输入即筛选列表；在非第 1 页修改条件会自动回到第 1 页并查询。</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchProductName}
                onChange={(e) => setSearchProductName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRefreshList()}
                placeholder="产品名称"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchCompanyName}
                onChange={(e) => setSearchCompanyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRefreshList()}
                placeholder="生产企业"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={searchDrugCode}
                onChange={(e) => setSearchDrugCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRefreshList()}
                placeholder="医保编码"
                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handleRefreshList}
              disabled={loading}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-1.5 shadow-sm disabled:opacity-60"
            >
              <Search className="h-4 w-4" />
              刷新
            </button>
            <button
              type="button"
              onClick={handleResetSearch}
              disabled={loading}
              className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium flex items-center gap-1.5 shadow-sm disabled:opacity-60"
            >
              <X className="h-4 w-4" />
              重置
            </button>
          </div>
        </div>

        {/* 第二段：新增/编辑区 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-slate-400" />
              {isEditing ? '修改监控药品' : '新增监控药品'}
            </h2>
            <button
              onClick={handleNew}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 text-sm font-medium shadow shadow-blue-200"
            >
              <Plus className="h-4 w-4" />
              新增药品
            </button>
          </div>
          <form onSubmit={handleSave}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">产品名称 *</label>
                <input
                  required
                  value={form.product_name}
                  onChange={e => setForm({...form, product_name: e.target.value})}
                  type="text"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                  placeholder="输入准确的药品名"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">生产企业</label>
                <input
                  value={form.company_name}
                  onChange={e => setForm({...form, company_name: e.target.value})}
                  type="text"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                  placeholder="选填"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">医保编码</label>
                <input
                  value={form.national_drug_code}
                  onChange={e => setForm({...form, national_drug_code: e.target.value})}
                  type="text"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                  placeholder="选填"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">最小包装数</label>
                <input
                  value={form.min_pac_quantity}
                  onChange={e => setForm({...form, min_pac_quantity: e.target.value})}
                  type="text"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                  placeholder="例如: 10"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">计量单位</label>
                <input
                  value={form.min_measure_unit}
                  onChange={e => setForm({...form, min_measure_unit: e.target.value})}
                  type="text"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                  placeholder="例如: 支/片/粒"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 mt-5">
              <button type="submit" className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-medium transition-colors">
                {isEditing ? '保存修改' : '确认加入监控'}
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => { setIsEditing(false); setForm({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' }); }}
                  className="px-6 py-2.5 bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
                >
                  取消编辑
                </button>
              )}
            </div>
          </form>
        </div>

        {/* 第三段：列表区 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 bg-rose-50/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-sm text-slate-700">
              全局未匹配 <span className="font-semibold text-rose-700">{unmatchedTotal}</span> 条
            </p>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyShowUnmatched}
                onChange={(e) => setOnlyShowUnmatched(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
              />
              仅看未匹配
            </label>
          </div>
          <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
            <h3 className="font-semibold text-slate-800">当前监控列表 ({total})</h3>
            <button onClick={() => fetchDrugs(page, pageSize)} className="text-slate-400 hover:text-blue-600 transition-colors p-1" title="刷新列表">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-4 font-semibold">产品信息</th>
                  <th className="px-5 py-4 font-semibold">企业及包装</th>
                  <th className="px-5 py-4 font-semibold">医保编码</th>
                  <th className="px-5 py-4 font-semibold">匹配状态</th>
                  <th className="px-5 py-4 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {drugs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      {loading ? '正在加载数据...' : onlyShowUnmatched ? '当前没有未匹配记录' : '目前尚未配置任何需要监控的药品'}
                    </td>
                  </tr>
                ) : (
                  drugs.map((drug) => (
                    <tr key={drug.id} className="group hover:bg-blue-50/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-medium text-slate-800">{drug.product_name}</div>
                        <div className="text-xs text-slate-400 mt-1">
                          {new Date(drug.created_at).toLocaleDateString()} 添加
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-sm text-slate-600">{drug.company_name || '-'}</div>
                        {(drug.min_pac_quantity || drug.min_measure_unit) && (
                          <div className="inline-flex items-center mt-1 px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-500">
                            {drug.min_pac_quantity || '?'} {drug.min_measure_unit || ''}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-sm font-mono text-slate-500">{drug.national_drug_code || '-'}</div>
                      </td>
                      <td className="px-5 py-4">
                        {drug.match_status === 'matched' ? (
                          <div className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">
                            已匹配
                          </div>
                        ) : (
                          <div>
                            <div className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-rose-100 text-rose-700">
                              未匹配
                            </div>
                            <div className="text-xs text-rose-600 mt-1 max-w-[260px]" title={drug.match_hint || ''}>
                              {drug.match_hint || '未匹配'}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => handleEdit(drug)} className="p-1.5 text-slate-400 hover:text-blue-600 bg-white rounded-md shadow-sm border border-slate-100 transition-colors">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(drug.id)} className="p-1.5 text-slate-400 hover:text-red-600 bg-white rounded-md shadow-sm border border-slate-100 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 分页栏 */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-sm text-slate-500">
                共 <span className="font-medium text-slate-700">{total}</span> 条，
                第 <span className="font-medium text-slate-700">{page}</span> / <span className="font-medium text-slate-700">{totalPages}</span> 页
              </div>
              <div className="flex items-center gap-2">
                {/* 每页条数选择 */}
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const newSize = parseInt(e.target.value, 10);
                    setPageSize(newSize);
                    setPage(1);
                  }}
                  className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-600 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                >
                  <option value={10}>10条/页</option>
                  <option value={20}>20条/页</option>
                  <option value={50}>50条/页</option>
                  <option value={100}>100条/页</option>
                </select>

                {/* 上一页 */}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:bg-slate-100 transition-colors bg-white shadow-sm"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                {/* 页码按钮 */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => {
                      // 只显示当前页附近的页码，避免过多按钮
                      if (totalPages <= 7) return true;
                      if (p === 1 || p === totalPages) return true;
                      if (p >= page - 1 && p <= page + 1) return true;
                      return false;
                    })
                    .map((p, idx, arr) => {
                      // 插入省略号
                      const showEllipsis = idx > 0 && p - arr[idx - 1] > 1;
                      return (
                        <React.Fragment key={p}>
                          {showEllipsis && (
                            <span className="px-2 text-slate-400 text-sm">...</span>
                          )}
                          <button
                            type="button"
                            onClick={() => setPage(p)}
                            disabled={loading}
                            className={`min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition-colors border shadow-sm ${
                              p === page
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      );
                    })}
                </div>

                {/* 下一页 */}
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-40 disabled:bg-slate-100 transition-colors bg-white shadow-sm"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
