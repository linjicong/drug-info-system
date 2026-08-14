import { NextRequest, NextResponse } from 'next/server';
import {
  getMergedDrugList,
  exportMergedDrugData,
} from '@/lib/merged-drug-service';
import type { MergedDrugInfo } from '@/components/drug/types';
import {
  getUnifiedSchedulerConfig,
  updateUnifiedSchedulerConfig,
  getLatestScrapeLog,
  getLatestDataTime,
  initUnifiedScheduler,
  canStartScrape,
  createScrapeLog,
} from '@/lib/unified-scheduler';
import { mergeProgressFromDb, resetTaskProgress } from '@/lib/task-progress-repo';
import { parseDrugFilterParams, parsePaginationParams } from '@/lib/api/drug-query-params';
import { jsonError, pagedResponse } from '@/lib/api/responses';
import { buildExcelResponse } from '@/lib/api/excel-export';
import { createModuleRoute } from '@/lib/api/module-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SOURCE = 'merged_drug' as const;

/**
 * 药品汇总（merged）页面模块路由
 * GET  /api/merged            - 整合药品列表
 * GET  /api/merged/export     - 导出 Excel（药品汇总表-YYYYMMDD.xlsx）
 * GET/POST /api/merged/scheduler - 调度器配置读取 / 更新
 * POST /api/merged/sync       - 手动触发合并同步
 * GET/DELETE /api/merged/sync/progress - 合并进度轮询 / 重置（POST 405）
 */

async function getList(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize } = parsePaginationParams(searchParams);
    // merged 路由的 companyName 不接受 manufacturer 别名（保持原行为）
    const filters = parseDrugFilterParams(searchParams, { manufacturerAlias: false });

    const result = await getMergedDrugList({ page, pageSize, ...filters });

    return pagedResponse({ data: result.data, page, pageSize, total: result.total });
  } catch (error) {
    console.error('[API] 整合药品查询错误:', error);
    return jsonError('查询失败', 500, error);
  }
}

async function exportExcel(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    // merged 导出的 companyName 不接受 manufacturer 别名（保持原行为）
    const filters = parseDrugFilterParams(searchParams, { manufacturerAlias: false });
    const source = searchParams.get('source') || undefined;
    const medicareTypeLabel = searchParams.get('medicareTypeLabel') || undefined;

    const allData = await exportMergedDrugData({
      ...filters,
      source,
      medicareTypeLabel,
    });

    if (allData.length === 0) {
      return jsonError('没有可导出的数据', 400);
    }

    // 来源标签映射
    const sourceMap: Record<string, string> = {
      gd_only: '仅广东医保',
      gz_only: '仅广州采购',
      both: '双源匹配',
    };

    // 将数据映射为 Excel 工作表格式
    const worksheetData = (allData as MergedDrugInfo[]).map((item, index) => ({
      '序号': index + 1,
      '产品名称': item.product_name,
      '医保编码': item.national_drug_code ?? '',
      '剂型': item.dosform ?? '',
      '生产企业': item.company_name ?? '',
      '规格': item.spec ?? '',
      '最小包装数量': item.min_pac_quantity ?? '',
      '最小包装单位': item.min_pac_unit ?? '',
      '最小计量单位': item.min_measure_unit ?? '',
      '药品挂网类别': item.drug_net_type ?? '',
      '挂网时间': item.net_time ?? '',
      '医保甲乙类': item.medicare_type_label ?? '',
      '包装材料': item.package_material ?? '',
      '省平台挂网价格(元)': item.gd_price ?? '',
      'GPO挂网价格(元)': item.gz_bid_price ?? '',
      'GPO挂网最小规格价格(元)': item.gz_min_unit_price ?? '',
      '数据来源': sourceMap[item.source] ?? item.source,
    }));

    // 设置列宽
    const colWidths = [
      { wch: 6 },   // 序号
      { wch: 30 },  // 产品名称
      { wch: 22 },  // 医保编码
      { wch: 14 },  // 剂型
      { wch: 32 },  // 生产企业
      { wch: 24 },  // 规格
      { wch: 14 },  // 最小包装数量
      { wch: 14 },  // 最小包装单位
      { wch: 14 },  // 最小计量单位
      { wch: 16 },  // 药品挂网类别
      { wch: 20 },  // 挂网时间
      { wch: 12 },  // 医保甲乙类
      { wch: 20 },  // 包装材料
      { wch: 18 },  // 省平台挂网价格
      { wch: 16 },  // GPO挂网价格
      { wch: 22 },  // GPO挂网最小规格价格
      { wch: 14 },  // 数据来源
    ];

    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

    return buildExcelResponse({
      rows: worksheetData,
      sheetName: '药品汇总表',
      colWidths,
      filename: `药品汇总表-${ts}.xlsx`,
    });
  } catch (error) {
    console.error('[API] 药品汇总表导出错误:', error);
    return jsonError('导出失败', 500, error);
  }
}

// ---- 调度器（merged 使用"定时同步"文案，保持独立实现）----

// 初始化标记
let initialized = false;

async function getScheduler() {
  try {
    if (!initialized) {
      await initUnifiedScheduler(SOURCE);
      initialized = true;
    }

    const config = await getUnifiedSchedulerConfig(SOURCE);

    if (!config) {
      return NextResponse.json({
        success: false,
        message: '无法获取调度器配置',
      }, { status: 500 });
    }

    const latestLog = await getLatestScrapeLog(SOURCE);
    const latestDataTime = await getLatestDataTime(SOURCE);

    return NextResponse.json({
      success: true,
      data: {
        enabled: config.enabled,
        intervalMinutes: config.interval_minutes,
        nextRunAt: config.next_run_at,
        lastRunAt: config.last_run_at,
        lastRunStatus: config.last_run_status,
        cronSecret: config.cron_secret,
        isRunning: config.running_status === 'running',
        runningStatus: config.running_status,
        latestLog: latestLog ? {
          startTime: latestLog.start_time,
          endTime: latestLog.end_time,
          status: latestLog.status,
          totalCount: latestLog.total_count,
          newCount: latestLog.new_count,
          updateCount: latestLog.update_count,
          durationSeconds: latestLog.duration_seconds,
        } : null,
        latestDataTime,
      },
    });
  } catch (error) {
    console.error('[API] 获取调度器配置失败:', error);
    return NextResponse.json({
      success: false,
      message: '获取调度器配置失败',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

async function updateScheduler(request: NextRequest) {
  try {
    if (!initialized) {
      await initUnifiedScheduler(SOURCE);
      initialized = true;
    }

    const body = await request.json();
    const { enabled, intervalMinutes, cronSecret } = body;

    // 验证参数
    const updateData: { enabled?: boolean; interval_minutes?: number; cron_secret?: string } = {};

    if (typeof enabled === 'boolean') {
      updateData.enabled = enabled;
    }

    if (typeof intervalMinutes === 'number' && intervalMinutes >= 1 && intervalMinutes <= 1440) {
      updateData.interval_minutes = intervalMinutes;
    }

    if (typeof cronSecret === 'string') {
      updateData.cron_secret = cronSecret;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({
        success: false,
        message: '无效的配置参数',
      }, { status: 400 });
    }

    const updated = await updateUnifiedSchedulerConfig(SOURCE, updateData);

    return NextResponse.json({
      success: true,
      message: updateData.enabled === true
        ? `定时同步已配置，每 ${updated!.interval_minutes} 分钟执行一次`
        : updateData.enabled === false
          ? '定时同步已停止'
          : '配置已更新',
      data: {
        enabled: updated!.enabled,
        intervalMinutes: updated!.interval_minutes,
        nextRunAt: updated!.next_run_at,
      },
    });
  } catch (error) {
    console.error('[API] 更新调度器配置失败:', error);
    return NextResponse.json({
      success: false,
      message: '更新调度器配置失败',
      error: error instanceof Error ? error.message : '未知错误',
    }, { status: 500 });
  }
}

// ---- 手动触发合并同步（入队，由 GitHub Actions runner 认领执行）----

async function triggerSync() {
  try {
    const { canStart, reason } = await canStartScrape(SOURCE);
    if (!canStart) {
      return NextResponse.json(
        { success: false, message: reason },
        { status: 409 }
      );
    }

    // 插入 queued 日志即入队，runner 下个周期认领执行
    const logId = await createScrapeLog(SOURCE, 'manual', 'queued');
    if (!logId) {
      return NextResponse.json(
        { success: false, message: '合并任务入队失败' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '合并任务已加入执行队列',
    });
  } catch (error) {
    console.error('[API] 触发合并任务错误:', error);
    return NextResponse.json(
      {
        success: false,
        message: '触发失败',
        error: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 }
    );
  }
}

// ---- 合并进度（供前端轮询，读 task_progress 表）----

async function getSyncProgress() {
  const progress = await mergeProgressFromDb();
  return NextResponse.json(progress, {
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

async function resetSyncProgress() {
  await resetTaskProgress(SOURCE);
  return NextResponse.json({ success: true });
}

export const { GET, POST, PUT, DELETE } = createModuleRoute({
  '': { GET: getList },
  'export': { GET: exportExcel },
  'scheduler': { GET: getScheduler, POST: updateScheduler },
  'sync': { POST: triggerSync },
  'sync/progress': { GET: getSyncProgress, DELETE: resetSyncProgress },
});
