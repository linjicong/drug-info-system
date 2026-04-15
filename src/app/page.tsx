'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { toast, Toaster } from 'sonner';
import { 
  RefreshCw, 
  Download, 
  Search, 
  Clock, 
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

// 药品信息接口 - 完全匹配API返回字段（共23个API字段）
interface DrugInfo {
  id: string;
  // 商品ID（与procurecatalog_id组成复合唯一键）
  goods_id: string;
  // 采购目录ID（与goods_id组成复合唯一键）
  procurecatalog_id: string;
  // 药品通用名
  product_name: string;
  // 药品商品名
  goods_name?: string;
  // 生产企业
  company_name_sc?: string;
  // 剂型名称
  medicinemodel?: string;
  // 规格（包装单位）
  unit?: string;
  // 最小规格
  min_unit?: string;
  // 规格包装
  outlook?: string;
  // 规格ID
  unit_id?: string;
  // 数量
  factor?: number;
  // 规格包装单位数值
  outlook_unit?: number;
  // 包装单位参考价格(元)
  bid_price?: number;
  // 最小制剂单位参考价格(元)
  min_unit_price?: number;
  // 最高挂网价格(元)
  max_listing_price?: number;
  // 医保编码
  national_drug_code?: string;
  // 采购方式
  purchase_type?: number;
  // 甲乙类（0-非医保，1-甲类，2-乙类）
  medicare_type?: number;
  // 药品挂网类别
  source_type?: string;
  // 材料名称
  material_name?: string;
  // 隐藏价格标志
  hidden_price_flag?: number;
  // 活跃分区标志
  subarea_flag?: number;
  // 商品状态
  is_out_stock?: number;
  // 费率
  fs_rate?: number;
  // 挂网时间
  net_time?: string;
  // 价格形成时间
  price_formation_time?: string;
  // 系统字段
  created_at: string;
  updated_at?: string;
}

interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface FetchProgress {
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

// 调度器配置接口
interface SchedulerConfig {
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

export default function DrugManagementPage() {
  // 状态管理
  const [drugs, setDrugs] = useState<DrugInfo[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  
  // 抓取进度状态
  const [progress, setProgress] = useState<FetchProgress>({
    status: 'idle',
    currentPage: 0,
    totalPages: 0,
    processedCount: 0,
    totalCount: 0,
    newCount: 0,
    updateCount: 0,
    startTime: null,
    endTime: null,
    error: null,
  });
  
  // 定时抓取配置（从后端获取）
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig>({
    enabled: false,
    intervalMinutes: 60,
    nextRunAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    isRunning: false,
  });
  const [configLoading, setConfigLoading] = useState(false);
  
  // 进度轮询定时器
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 加载调度器配置
  const loadSchedulerConfig = useCallback(async () => {
    try {
      const response = await fetch('/api/scheduler');
      const result = await response.json();
      
      if (result.success) {
        setSchedulerConfig(result.data);
      }
    } catch (error) {
      console.error('加载调度器配置失败:', error);
    }
  }, []);

  // 加载药品列表
  const loadDrugs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (searchKeyword) params.append('search', searchKeyword);

      const response = await fetch(`/api/drugs?${params}`);
      const result = await response.json();

      if (result.success) {
        setDrugs(result.data);
        setPagination(result.pagination);
      } else {
        toast.error('加载失败', { description: result.message });
      }
    } catch {
      toast.error('加载失败', { description: '网络错误，请重试' });
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, searchKeyword]);

  // 更新调度器配置
  const updateSchedulerConfig = async (updates: { enabled?: boolean; intervalMinutes?: number }) => {
    setConfigLoading(true);
    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const result = await response.json();
      
      if (result.success) {
        setSchedulerConfig(prev => ({
          ...prev,
          ...result.data,
        }));
        toast.success(result.message);
      } else {
        toast.error('配置更新失败', { description: result.message });
      }
    } catch (error) {
      toast.error('配置更新失败', { description: '网络错误' });
    } finally {
      setConfigLoading(false);
    }
  };

  // 轮询进度
  const startProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch('/api/drugs/progress');
        const data: FetchProgress = await response.json();
        setProgress(data);

        // 同时刷新调度器配置以更新运行状态
        loadSchedulerConfig();

        if (data.status === 'completed') {
          toast.success('抓取完成', {
            description: `新增 ${data.newCount} 条，更新 ${data.updateCount} 条`,
          });
          stopProgressPolling();
          loadDrugs();
        }

        if (data.status === 'error' && data.error) {
          toast.error('抓取失败', { description: data.error });
          stopProgressPolling();
        }
      } catch (e) {
        console.error('获取进度失败:', e);
      }
    }, 1000);
  }, [loadDrugs, loadSchedulerConfig]);

  const stopProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  // 手动抓取
  const handleFetch = async () => {
    try {
      // 开始轮询进度
      startProgressPolling();

      const response = await fetch('/api/drugs/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json();

      if (!result.success) {
        toast.error('抓取失败', { description: result.message });
        stopProgressPolling();
      }
    } catch {
      toast.error('抓取失败', { description: '网络错误，请重试' });
      stopProgressPolling();
    }
  };

  // 导出 Excel（导出所有数据）
  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/drugs/export');
      
      if (!response.ok) {
        const result = await response.json();
        toast.error('导出失败', { description: result.message });
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // 从响应头获取文件名并解码
      const contentDisposition = response.headers.get('content-disposition');
      let filename = '药品信息.xlsx';
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;'"]+)/i);
        if (filenameMatch && filenameMatch[1]) {
          filename = decodeURIComponent(filenameMatch[1]);
        }
      }
      link.download = filename;
      
      link.click();
      window.URL.revokeObjectURL(url);

      toast.success('导出成功', { description: 'Excel 文件已下载' });
    } catch {
      toast.error('导出失败', { description: '网络错误，请重试' });
    } finally {
      setExporting(false);
    }
  };

  // 初始加载
  useEffect(() => {
    loadDrugs();
    loadSchedulerConfig();
  }, [loadDrugs, loadSchedulerConfig]);

  // 清理定时器
  useEffect(() => {
    return () => {
      stopProgressPolling();
    };
  }, [stopProgressPolling]);

  // 搜索处理
  const handleSearch = () => {
    setPagination({ ...pagination, page: 1 });
    loadDrugs();
  };

  // 分页处理
  const handlePageChange = (newPage: number) => {
    setPagination({ ...pagination, page: newPage });
  };

  // 展开/收起行
  const toggleRowExpand = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  // 计算进度百分比
  const progressPercent = progress.totalCount > 0 
    ? Math.round((progress.processedCount / progress.totalCount) * 100) 
    : 0;

  // 格式化时间
  const formatDuration = () => {
    if (!progress.startTime) return '-';
    const endTime = progress.endTime || Date.now();
    const seconds = Math.floor((endTime - progress.startTime) / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}分${remainingSeconds}秒`;
  };

  // 格式化价格
  const formatPrice = (price?: number) => {
    if (price === undefined || price === null) return '-';
    return `¥${price.toFixed(2)}`;
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Toaster position="top-right" />
      
      {/* 页面标题 */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              药品信息管理系统
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              广州药品采购平台公示信息抓取与管理
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => window.location.href = '/pubonln'}
          >
            广东医保挂网药品 →
          </Button>
        </div>
      </div>

      {/* 抓取进度卡片 */}
      {(progress.status === 'running' || progress.status === 'completed' || progress.status === 'error') && (
        <Card className={`mb-6 ${
          progress.status === 'running' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' :
          progress.status === 'completed' ? 'border-green-500 bg-green-50 dark:bg-green-950' :
          progress.status === 'error' ? 'border-red-500 bg-red-50 dark:bg-red-950' : ''
        }`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              {progress.status === 'running' && (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span>正在抓取数据...</span>
                </>
              )}
              {progress.status === 'completed' && (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <span>抓取完成</span>
                </>
              )}
              {progress.status === 'error' && (
                <>
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span>抓取出错</span>
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>进度: {progress.processedCount} / {progress.totalCount} 条</span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-3" />
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">当前页</span>
                <p className="font-medium">{progress.currentPage} / {progress.totalPages}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">新增</span>
                <p className="font-medium text-green-600">{progress.newCount} 条</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">更新</span>
                <p className="font-medium text-blue-600">{progress.updateCount} 条</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">耗时</span>
                <p className="font-medium">{formatDuration()}</p>
              </div>
            </div>
            
            {progress.status === 'error' && progress.error && (
              <div className="text-sm text-red-600 bg-red-100 dark:bg-red-900/50 p-2 rounded">
                错误: {progress.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 操作区域 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* 搜索 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="w-5 h-5" />
              搜索筛选
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Input
                  placeholder="搜索药品名称、商品名或生产企业..."
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button onClick={handleSearch} disabled={loading}>
                搜索
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 定时抓取 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="w-5 h-5" />
              定时抓取
              {schedulerConfig.isRunning && (
                <Badge variant="default" className="ml-2">运行中</Badge>
              )}
            </CardTitle>
            <CardDescription>
              后端定时任务，页面关闭后仍会继续执行
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="auto-fetch"
                    checked={schedulerConfig.enabled}
                    onCheckedChange={(enabled) => updateSchedulerConfig({ enabled })}
                    disabled={configLoading}
                  />
                  <Label htmlFor="auto-fetch" className="font-medium">
                    启用定时抓取
                  </Label>
                </div>
                {schedulerConfig.enabled && (
                  <Select 
                    value={String(schedulerConfig.intervalMinutes)} 
                    onValueChange={(value) => updateSchedulerConfig({ intervalMinutes: parseInt(value) })}
                    disabled={configLoading}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 分钟</SelectItem>
                      <SelectItem value="60">1 小时</SelectItem>
                      <SelectItem value="120">2 小时</SelectItem>
                      <SelectItem value="360">6 小时</SelectItem>
                      <SelectItem value="720">12 小时</SelectItem>
                      <SelectItem value="1440">24 小时</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
            <div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-400">
              {schedulerConfig.nextRunAt && (
                <p>下次执行时间: {new Date(schedulerConfig.nextRunAt).toLocaleString()}</p>
              )}
              {schedulerConfig.lastRunAt && (
                <p>
                  上次执行: {new Date(schedulerConfig.lastRunAt).toLocaleString()}
                  {schedulerConfig.lastRunStatus && (
                    <Badge 
                      variant={schedulerConfig.lastRunStatus === 'success' ? 'default' : 'destructive'}
                      className="ml-2"
                    >
                      {schedulerConfig.lastRunStatus === 'success' ? '成功' : '失败'}
                    </Badge>
                  )}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 数据统计 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">数据统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-gray-500 dark:text-gray-400">总记录数</span>
              <p className="text-2xl font-bold text-blue-600">{pagination.total.toLocaleString()}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">当前页</span>
              <p className="text-2xl font-bold">{pagination.page} / {pagination.totalPages}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">最新数据时间</span>
              <p className="text-lg font-medium">
                {schedulerConfig.latestDataTime 
                  ? new Date(schedulerConfig.latestDataTime).toLocaleString()
                  : '-'}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">运行状态</span>
              <p className="text-lg font-medium">
                <Badge variant={schedulerConfig.runningStatus === 'running' ? 'default' : 'secondary'}>
                  {schedulerConfig.runningStatus === 'running' ? '抓取中' : '空闲'}
                </Badge>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-4 mb-6">
        <Button 
          onClick={handleFetch} 
          disabled={progress.status === 'running'}
          className="flex items-center gap-2"
        >
          {progress.status === 'running' ? (
            <>
              <PauseCircle className="w-4 h-4" />
              抓取中...
            </>
          ) : (
            <>
              <PlayCircle className="w-4 h-4" />
              手动抓取
            </>
          )}
        </Button>
        
        <Button 
          onClick={handleExport} 
          disabled={exporting}
          variant="outline"
          className="flex items-center gap-2"
        >
          {exporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              导出中...
            </>
          ) : (
            <>
              <FileSpreadsheet className="w-4 h-4" />
              导出 Excel
            </>
          )}
        </Button>

        <Badge variant="outline" className="flex items-center gap-2 py-2 px-4">
          共 {pagination.total} 条记录
        </Badge>
      </div>

      {/* 数据表格 */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : drugs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <AlertCircle className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">暂无数据</p>
              <p className="text-sm mt-2">点击"手动抓取"按钮获取药品信息</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>产品名称</TableHead>
                      <TableHead>商品名</TableHead>
                      <TableHead>剂型</TableHead>
                      <TableHead>规格</TableHead>
                      <TableHead>生产企业</TableHead>
                      <TableHead className="text-right">中标价</TableHead>
                      <TableHead className="text-right">最小单位价</TableHead>
                      <TableHead>单位</TableHead>
                      <TableHead>来源类型</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {drugs.map((drug) => {
                      const isExpanded = expandedRows.has(drug.id);
                      return (
                        <Fragment key={drug.id}>
                          <TableRow className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleRowExpand(drug.id)}
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium text-blue-600 dark:text-blue-400">
                              {drug.product_name}
                            </TableCell>
                            <TableCell>{drug.goods_name || '-'}</TableCell>
                            <TableCell>{drug.medicinemodel || '-'}</TableCell>
                            <TableCell>{drug.outlook || '-'}</TableCell>
                            <TableCell>{drug.company_name_sc || '-'}</TableCell>
                            <TableCell className="text-right font-medium text-green-600">
                              {formatPrice(drug.bid_price)}
                            </TableCell>
                            <TableCell className="text-right">{formatPrice(drug.min_unit_price)}</TableCell>
                            <TableCell>{drug.unit || '-'}</TableCell>
                            <TableCell>
                              <Badge variant={drug.source_type === '省采中选' ? 'default' : 'secondary'}>
                                {drug.source_type || '-'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow className="bg-gray-50 dark:bg-gray-900">
                              <TableCell colSpan={10} className="p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                                  <div>
                                    <span className="text-gray-500">商品ID</span>
                                    <p className="font-mono">{drug.goods_id || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">医保编码</span>
                                    <p className="font-mono">{drug.national_drug_code || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">采购目录ID</span>
                                    <p className="font-mono">{drug.procurecatalog_id || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">规格ID</span>
                                    <p className="font-mono">{drug.unit_id || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">最小规格</span>
                                    <p>{drug.min_unit || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">数量(转换因子)</span>
                                    <p>{drug.factor || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">最高挂网价(元)</span>
                                    <p>{formatPrice(drug.max_listing_price)}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">费率</span>
                                    <p>{drug.fs_rate ?? '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">采购方式</span>
                                    <p>{drug.purchase_type === 1 ? '集中采购' : drug.purchase_type === 2 ? '其他' : drug.purchase_type || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">甲乙类</span>
                                    <p>{drug.medicare_type === 0 ? '非医保' : drug.medicare_type === 1 ? '甲类' : drug.medicare_type === 2 ? '乙类' : drug.medicare_type ?? '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">材料名称</span>
                                    <p className="truncate" title={drug.material_name || ''}>{drug.material_name || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">商品状态</span>
                                    <p>{drug.is_out_stock === 1 ? '停用' : '正常'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">隐藏价格</span>
                                    <p>{drug.hidden_price_flag === 1 ? '是' : '否'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">活跃分区</span>
                                    <p>{drug.subarea_flag === 1 ? '是' : '否'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">规格单位数值</span>
                                    <p>{drug.outlook_unit ?? '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">挂网时间</span>
                                    <p>{drug.net_time || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">价格形成时间</span>
                                    <p>{drug.price_formation_time || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">创建时间</span>
                                    <p>{new Date(drug.created_at).toLocaleString()}</p>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* 分页 */}
              {pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-4 border-t">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    第 {pagination.page} / {pagination.totalPages} 页
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page - 1)}
                      disabled={pagination.page === 1}
                    >
                      上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePageChange(pagination.page + 1)}
                      disabled={pagination.page === pagination.totalPages}
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 使用说明 */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            使用说明
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
          <p>1. <strong>手动抓取</strong>：点击"手动抓取"按钮立即从广州药品采购平台获取最新数据</p>
          <p>2. <strong>实时进度</strong>：抓取过程中实时显示进度条、已处理条数、新增/更新数量</p>
          <p>3. <strong>展开详情</strong>：点击行首的展开按钮查看完整字段信息</p>
          <p>4. <strong>定时抓取</strong>：启用定时抓取功能，系统将按设定的时间间隔自动更新数据</p>
          <p>5. <strong>导出数据</strong>：点击"导出 Excel"按钮将当前筛选结果下载为 Excel 文件</p>
          <p className="mt-4 text-xs">
            数据来源：<a 
              href="https://gpo.gzggzy.cn/webPortal/publicity/toNotice.html" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              广州药品采购平台公示信息
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
