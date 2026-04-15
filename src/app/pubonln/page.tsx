'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast, Toaster } from 'sonner';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronUp,
  Clock,
} from 'lucide-react';

// 挂网药品信息接口 - 完整字段
interface PubonlnDrugInfo {
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

export default function PubonlnDrugManagementPage() {
  // 状态管理
  const [drugs, setDrugs] = useState<PubonlnDrugInfo[]>([]);
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
      const response = await fetch('/api/pubonln/scheduler');
      const result = await response.json();
      
      if (result.success) {
        setSchedulerConfig(result.data);
      }
    } catch (error) {
      console.error('加载调度器配置失败:', error);
    }
  }, []);

  // 更新调度器配置
  const updateSchedulerConfig = async (updates: { enabled?: boolean; intervalMinutes?: number }) => {
    setConfigLoading(true);
    try {
      const response = await fetch('/api/pubonln/scheduler', {
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

  // 加载药品列表
  const loadDrugs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (searchKeyword) params.append('search', searchKeyword);

      const response = await fetch(`/api/pubonln/drugs?${params}`);
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

  // 轮询进度
  const startProgressPolling = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
    }

    progressIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch('/api/pubonln/drugs/progress');
        const data: FetchProgress = await response.json();
        setProgress(data);

        // 同时刷新调度器配置以更新运行状态
        loadSchedulerConfig();

        if (data.status === 'completed') {
          toast.success('抓取完成', {
            description: `共处理 ${data.totalCount} 条数据`,
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

      const response = await fetch('/api/pubonln/drugs/fetch', {
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

  // 导出 Excel
  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch('/api/pubonln/drugs/export');

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
      let filename = '挂网药品信息.xlsx';
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
  const progressPercent =
    progress.totalCount > 0
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
              广东医保挂网药品管理系统
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              广东省医疗保障局挂网药品公示信息抓取与管理
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => window.location.href = '/'}
          >
            ← 广州药品采购平台
          </Button>
        </div>
      </div>

      {/* 抓取进度卡片 */}
      {(progress.status === 'running' ||
        progress.status === 'completed' ||
        progress.status === 'error') && (
        <Card
          className={`mb-6 ${
            progress.status === 'running'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : progress.status === 'completed'
                ? 'border-green-500 bg-green-50 dark:bg-green-950'
                : progress.status === 'error'
                  ? 'border-red-500 bg-red-50 dark:bg-red-950'
                  : ''
          }`}
        >
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
                <span>
                  进度: {progress.processedCount} / {progress.totalCount} 条
                </span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} className="h-3" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">当前页</span>
                <p className="font-medium">
                  {progress.currentPage} / {progress.totalPages}
                </p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">新增</span>
                <p className="font-medium text-green-600">{progress.newCount} 条</p>
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
            <CardTitle className="text-lg flex items-center gap-2">搜索筛选</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Input
                  placeholder="搜索通用名、商品名或上市许可持有人..."
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
                    id="auto-fetch-pubonln"
                    checked={schedulerConfig.enabled}
                    onCheckedChange={(enabled) => updateSchedulerConfig({ enabled })}
                    disabled={configLoading}
                  />
                  <Label htmlFor="auto-fetch-pubonln" className="font-medium">
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
              <p className="text-2xl font-bold">
                {pagination.page} / {pagination.totalPages}
              </p>
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
          共 {pagination.total.toLocaleString()} 条记录
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
              <p className="text-sm mt-2">点击"手动抓取"按钮获取挂网药品信息</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>通用名</TableHead>
                      <TableHead>商品名</TableHead>
                      <TableHead>剂型</TableHead>
                      <TableHead>规格</TableHead>
                      <TableHead>上市许可持有人</TableHead>
                      <TableHead className="text-right">挂网价格</TableHead>
                      <TableHead>质量层次</TableHead>
                      <TableHead>政策属性</TableHead>
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
                                {isExpanded ? (
                                  <ChevronUp className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell className="font-medium text-blue-600 dark:text-blue-400">
                              {drug.genname}
                            </TableCell>
                            <TableCell>{drug.trade_name || '-'}</TableCell>
                            <TableCell>{drug.dosform_name || '-'}</TableCell>
                            <TableCell className="max-w-xs truncate" title={drug.reg_spec_name || ''}>
                              {drug.reg_spec_name || '-'}
                            </TableCell>
                            <TableCell
                              className="max-w-xs truncate"
                              title={drug.listing_license_holder || ''}
                            >
                              {drug.listing_license_holder || '-'}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600">
                              {formatPrice(drug.min_pac_pubonln_pric)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  drug.quality_lv === '参比制剂'
                                    ? 'default'
                                    : drug.quality_lv === '过评'
                                      ? 'secondary'
                                      : 'outline'
                                }
                              >
                                {drug.quality_lv || '-'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{drug.policy_att || '-'}</Badge>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow className="bg-gray-50 dark:bg-gray-900">
                              <TableCell colSpan={9} className="p-4">
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                                  <div>
                                    <span className="text-gray-500">药品ID</span>
                                    <p className="font-mono">{drug.drug_id || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">医保编码</span>
                                    <p className="font-mono">{drug.drug_code || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">批准文号</span>
                                    <p className="font-mono">{drug.aprvno || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">生产企业</span>
                                    <p className="truncate" title={drug.prodentp_name || ''}>
                                      {drug.prodentp_name || '-'}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">申报企业</span>
                                    <p className="truncate" title={drug.dcla_entp_name || ''}>
                                      {drug.dcla_entp_name || '-'}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">最小单位</span>
                                    <p>{drug.minunt_name || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">最小包装</span>
                                    <p>{drug.minpac_name || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">转换系数</span>
                                    <p>{drug.convrat || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">甲乙类</span>
                                    <p>{drug.jyl_category || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">挂网时间</span>
                                    <p>{drug.pubonln_time || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">活跃区状态</span>
                                    <p>{drug.gw_active || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">包装材料</span>
                                    <p className="truncate" title={drug.pacmatl || ''}>
                                      {drug.pacmatl || '-'}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">注册剂型</span>
                                    <p>{drug.reg_dosform_name || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">形成方式</span>
                                    <p>{drug.formation_mode || '-'}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">停止挂网</span>
                                    <p>{drug.stop_pubonln === 1 ? '是' : '否'}</p>
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
          <p>1. 手动抓取：点击"手动抓取"按钮立即从广东省医疗保障局获取最新挂网药品数据</p>
          <p>2. 实时进度：抓取过程中实时显示进度条、已处理条数</p>
          <p>3. 展开详情：点击行首的展开按钮查看完整字段信息</p>
          <p>4. 导出数据：点击"导出 Excel"按钮将所有数据下载为 Excel 文件</p>
          <p className="mt-4 text-xs">
            数据来源：
            <a
              href="https://igi.hsa.gd.gov.cn/tps/tps_public/publicity/listPubonlnPublicityD"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              广东省医疗保障局挂网药品公示
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
