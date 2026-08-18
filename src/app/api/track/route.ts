import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/storage/database/db';
import { usageEvents } from '@/storage/database/shared/schema';
import { withDbRetry } from '@/lib/shared/db-retry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 合法事件类型 */
const EVENT_TYPES = [
  'page_view',
  'search_query',
  'export_data',
  'scrape_trigger',
  'ledger_operate',
] as const;

/** 单次批量上报上限 */
const BATCH_LIMIT = 50;
const MAX_USER_ID = 64;
const MAX_EVENT_NAME = 100;
const MAX_PAGE_PATH = 200;
const MAX_DETAIL_LEN = 4000;

interface TrackEvent {
  event_type: string;
  event_name: string;
  page_path: string;
  detail?: string;
}

/**
 * 校验单条事件，返回规整后的事件或错误信息
 */
function validateEvent(raw: unknown): { ok: true; event: TrackEvent } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '事件必须是对象' };
  }
  const e = raw as Record<string, unknown>;

  const { event_type, event_name, page_path, detail } = e;
  if (typeof event_type !== 'string' || !(EVENT_TYPES as readonly string[]).includes(event_type)) {
    return { ok: false, error: `event_type 不合法，可选值: ${EVENT_TYPES.join(' / ')}` };
  }
  if (typeof event_name !== 'string' || event_name.length === 0 || event_name.length > MAX_EVENT_NAME) {
    return { ok: false, error: `event_name 必填且不超过 ${MAX_EVENT_NAME} 字符` };
  }
  if (typeof page_path !== 'string' || !page_path.startsWith('/') || page_path.length > MAX_PAGE_PATH) {
    return { ok: false, error: `page_path 必填、以 / 开头且不超过 ${MAX_PAGE_PATH} 字符` };
  }

  let detailStr: string | undefined;
  if (detail !== undefined && detail !== null) {
    if (typeof detail !== 'object' || Array.isArray(detail)) {
      return { ok: false, error: 'detail 必须是对象' };
    }
    try {
      detailStr = JSON.stringify(detail);
    } catch {
      return { ok: false, error: 'detail 序列化失败' };
    }
    if (detailStr.length > MAX_DETAIL_LEN) {
      return { ok: false, error: `detail 序列化后不能超过 ${MAX_DETAIL_LEN} 字符` };
    }
  }

  return { ok: true, event: { event_type, event_name, page_path, detail: detailStr } };
}

/**
 * POST /api/track
 * 用户行为埋点上报：单条对象或批量数组，X-User-Id header 传匿名用户 ID
 * 返回 { success, count }；校验失败返回 400 { error }
 */
export async function POST(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) {
    return NextResponse.json({ error: '缺少 X-User-Id header' }, { status: 400 });
  }
  if (userId.length > MAX_USER_ID) {
    return NextResponse.json({ error: `X-User-Id 不能超过 ${MAX_USER_ID} 字符` }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const rawList = Array.isArray(body) ? body : [body];
  if (rawList.length === 0) {
    return NextResponse.json({ error: '事件列表不能为空' }, { status: 400 });
  }
  if (rawList.length > BATCH_LIMIT) {
    return NextResponse.json({ error: `单次上报不能超过 ${BATCH_LIMIT} 条` }, { status: 400 });
  }

  const events: TrackEvent[] = [];
  for (const raw of rawList) {
    const result = validateEvent(raw);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    events.push(result.event);
  }

  try {
    // 复用 withDbRetry 容错：抓取任务高峰期 TiDB 瞬时写失败时自动重试，减少埋点丢失
    await withDbRetry(
      () =>
        db.insert(usageEvents).values(
          events.map((e) => ({
            user_id: userId,
            event_type: e.event_type,
            event_name: e.event_name,
            page_path: e.page_path,
            detail: e.detail,
          })),
        ),
      3,
      '埋点写入'
    );
    return NextResponse.json({ success: true, count: events.length });
  } catch (error) {
    console.error('[API] 埋点写入失败:', error);
    return NextResponse.json({ error: '埋点写入失败' }, { status: 500 });
  }
}
