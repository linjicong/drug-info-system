'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Edit, Upload, RefreshCw, HardDrive, LayoutGrid, FileDown } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function TrackedDrugsPage() {
  const [drugs, setDrugs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  
  const [form, setForm] = useState({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' });
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDrugs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ledger/tracked-drugs');
      const data = await res.json();
      if (data.success) {
        setDrugs(data.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrugs();
  }, []);

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
        const res = await fetch('/api/ledger/tracked-drugs', {
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

  return (
    <div className="min-h-screen bg-slate-50/50 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header Area */}
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
            <button 
              onClick={() => {
                setForm({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' });
                setIsEditing(false);
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2 text-sm font-medium shadow shadow-blue-200"
            >
              <Plus className="h-4 w-4" />
              新增药品
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form Area */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 sticky top-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-5 flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-slate-400" />
                {isEditing ? '修改监控药品' : '手工录入药品'}
              </h2>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5">产品名称 *</label>
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
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5">生产企业</label>
                  <input
                    value={form.company_name}
                    onChange={e => setForm({...form, company_name: e.target.value})}
                    type="text"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                    placeholder="选填"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5">医保编码</label>
                  <input
                    value={form.national_drug_code}
                    onChange={e => setForm({...form, national_drug_code: e.target.value})}
                    type="text"
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                    placeholder="选填"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5">最小包装数</label>
                    <input
                      value={form.min_pac_quantity}
                      onChange={e => setForm({...form, min_pac_quantity: e.target.value})}
                      type="text"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                      placeholder="例如: 10"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-widest mb-1.5">计量单位</label>
                    <input
                      value={form.min_measure_unit}
                      onChange={e => setForm({...form, min_measure_unit: e.target.value})}
                      type="text"
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition-all text-sm outline-none"
                      placeholder="例如: 支/片/粒"
                    />
                  </div>
                </div>
                <div className="pt-4">
                  <button type="submit" className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-medium transition-colors">
                    {isEditing ? '保存修改' : '确认加入监控'}
                  </button>
                  {isEditing && (
                    <button 
                      type="button" 
                      onClick={() => { setIsEditing(false); setForm({ id: '', product_name: '', national_drug_code: '', company_name: '', min_pac_quantity: '', min_measure_unit: '' }); }}
                      className="w-full mt-2 py-2.5 bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl text-sm font-medium transition-colors"
                    >
                      取消编辑
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

          {/* Table Area */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <h3 className="font-semibold text-slate-800">当前监控列表 ({drugs.length})</h3>
                <button onClick={fetchDrugs} className="text-slate-400 hover:text-blue-600 transition-colors p-1" title="刷新列表">
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
                      <th className="px-5 py-4 font-semibold text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/80">
                    {drugs.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-12 text-center text-slate-400">
                          {loading ? '正在加载数据...' : '目前尚未配置任何需要监控的药品'}
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
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
