import { NextRequest, NextResponse } from 'next/server';
import {
  getDailyLedgers,
  getDailyLedgersByDates,
  executeLedgerSnapshot,
  getTrackedDrugs,
  insertTrackedDrugs,
  replaceTrackedDrugs,
  updateTrackedDrug,
  deleteTrackedDrug,
} from '@/lib/ledger-service';
import { getUnifiedSchedulerConfig } from '@/lib/unified-scheduler';
import { createModuleRoute } from '@/lib/api/module-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 台账（ledger）页面模块路由（URL 与合并前保持一致）
 * GET  /api/ledger/history                - 台账历史查询
 * GET  /api/ledger/history/export-weekly  - 按日期列表查询（周一导出）
 * POST /api/ledger/manual-trigger         - 应用内手动触发快照
 * POST /api/ledger/scheduler              - cron 跑批（cron_secret 鉴权）
 * GET/POST/PUT/DELETE /api/ledger/tracked-drugs - 跟踪药品维护
 */

async function getHistory(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const productName = searchParams.get('productName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const companyName = searchParams.get('companyName') || undefined;
    const minPacQuantity = searchParams.get('minPacQuantity') || undefined;
    const minMeasureUnit = searchParams.get('minMeasureUnit') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const result = await getDailyLedgers({
      page,
      pageSize,
      productName,
      nationalDrugCode,
      companyName,
      minPacQuantity,
      minMeasureUnit,
      startDate,
      endDate,
    });

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: '查询台账历史数据失败', error: String(error) }, { status: 500 });
  }
}

/**
 * 按指定日期列表查询台账数据（用于周一导出）
 * GET /api/ledger/history/export-weekly?dates=2024-04-01,2024-04-08&productName=xxx
 */
async function getWeeklyExport(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const datesStr = searchParams.get('dates') || '';
    const productName = searchParams.get('productName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const companyName = searchParams.get('companyName') || undefined;
    const minPacQuantity = searchParams.get('minPacQuantity') || undefined;
    const minMeasureUnit = searchParams.get('minMeasureUnit') || undefined;

    // 解析逗号分隔的日期字符串
    const dates = datesStr
      .split(',')
      .map(d => d.trim())
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

    if (dates.length === 0) {
      return NextResponse.json({
        success: false,
        message: '未提供有效的日期参数',
      }, { status: 400 });
    }

    const data = await getDailyLedgersByDates(dates, {
      productName,
      nationalDrugCode,
      companyName,
      minPacQuantity,
      minMeasureUnit,
    });

    return NextResponse.json({
      success: true,
      data,
      dates, // 返回实际查询的日期列表，方便前端透视
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: '查询周一台账数据失败', error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * 应用内部手动触发台账快照生成接口
 * 与 cron 接口分离，避免在浏览器端暴露 cron_secret
 */
async function manualTrigger() {
  try {
    const result = await executeLedgerSnapshot();
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Ledger Manual Trigger] 手动触发失败:', error);
    return NextResponse.json(
      { success: false, message: '手动触发台账生成失败', error: String(error) },
      { status: 500 }
    );
  }
}

/**
 * 可以通过 cron jobs 每天调用一次，或者手动触发
 * 鉴权方式：从数据库 scheduler_config 表读取 cron_secret 进行校验
 */
async function runScheduler(request: NextRequest) {
  try {
    const passedSecret = request.headers.get('authorization')?.replace('Bearer ', '') || request.nextUrl.searchParams.get('secret');

    const config = await getUnifiedSchedulerConfig('ledger');

    if (!config) {
      return NextResponse.json(
        { success: false, message: 'Ledger scheduler config not found' },
        { status: 500 }
      );
    }

    if (!config.enabled) {
      return NextResponse.json({
        success: true,
        message: 'Ledger scheduler skipped',
        result: { status: 'skipped (disabled)' },
      });
    }

    const expectedSecret = config.cron_secret;
    if (expectedSecret && passedSecret !== expectedSecret) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized: invalid secret' },
        { status: 401 }
      );
    }

    const result = await executeLedgerSnapshot();

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Ledger Scheduler] 跑批失败:', error);
    return NextResponse.json(
      { success: false, message: '生成每天快照失败', error: String(error) },
      { status: 500 }
    );
  }
}

// ---- 跟踪药品维护 ----

async function getTracked(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const searchKeyword = searchParams.get('search') || undefined;
    const productName = searchParams.get('productName') || undefined;
    const companyName = searchParams.get('companyName') || undefined;
    const nationalDrugCode = searchParams.get('nationalDrugCode') || undefined;
    const onlyUnmatched = searchParams.get('onlyUnmatched') === 'true';

    const result = await getTrackedDrugs({ page, pageSize, searchKeyword, productName, companyName, nationalDrugCode, onlyUnmatched });

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
      summary: {
        unmatchedTotal: result.unmatchedTotal,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, message: '查询失败', error: String(error) }, { status: 500 });
  }
}

async function saveTracked(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const replace = searchParams.get('replace') === 'true';
    const body = await request.json();

    // 如果是数组，则批量插入；如果是对象，则包装为数组
    const data = Array.isArray(body) ? body : [body];

    const result = replace
      ? await replaceTrackedDrugs(data)
      : await insertTrackedDrugs(data);
    return NextResponse.json({ success: true, count: result.count });
  } catch (error) {
    return NextResponse.json({ success: false, message: '保存失败', error: String(error) }, { status: 500 });
  }
}

async function updateTracked(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少参数 ID' }, { status: 400 });
    }

    const updates = await request.json();
    await updateTrackedDrug(id, updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: '更新失败', error: String(error) }, { status: 500 });
  }
}

async function deleteTracked(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, message: '缺少参数 ID' }, { status: 400 });
    }

    await deleteTrackedDrug(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: '删除失败', error: String(error) }, { status: 500 });
  }
}

export const { GET, POST, PUT, DELETE } = createModuleRoute({
  'history': { GET: getHistory },
  'history/export-weekly': { GET: getWeeklyExport },
  'manual-trigger': { POST: manualTrigger },
  'scheduler': { POST: runScheduler },
  'tracked-drugs': { GET: getTracked, POST: saveTracked, PUT: updateTracked, DELETE: deleteTracked },
});
