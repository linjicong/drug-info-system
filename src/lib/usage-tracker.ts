/**
 * 前端埋点工具（client-only）
 *
 * 使用方式：页面/组件在操作成功后调用 trackEvent / trackPageView，
 * 事件进入内存队列批量上报 POST /api/track（header 携带匿名用户 ID），
 * 上报失败静默处理，不影响业务功能。
 *
 * 说明：navigator.sendBeacon 无法携带自定义 header（X-User-Id 必须经
 * header 传递），故统一使用 fetch keepalive（同源可靠，页面隐藏/卸载时
 * 尽力完成发送，单请求体 ≤64KB，前端单批上限 10 条远低于该限制）。
 */

export const USAGE_EVENT_TYPES = [
  'page_view',
  'search_query',
  'export_data',
  'scrape_trigger',
  'ledger_operate',
] as const;

export type UsageEventType = (typeof USAGE_EVENT_TYPES)[number];

export interface UsageEventPayload {
  event_type: UsageEventType;
  event_name: string;
  page_path: string;
  detail?: Record<string, unknown>;
}

/** localStorage 匿名用户 ID key */
const USER_ID_KEY = 'usage_user_id';
/** 批量发送周期（ms） */
const FLUSH_INTERVAL_MS = 5000;
/** 队列触发批量发送的条数上限 */
const QUEUE_LIMIT = 10;

let userId: string | null = null;
let pending: UsageEventPayload[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function isClient(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * 读取或生成匿名用户 ID（UUID，存 localStorage）
 */
export function getOrCreateUserId(): string {
  if (userId) return userId;
  if (!isClient()) return '';
  try {
    userId = localStorage.getItem(USER_ID_KEY);
    if (!userId) {
      userId = crypto.randomUUID();
      localStorage.setItem(USER_ID_KEY, userId);
    }
  } catch {
    // localStorage 不可用（隐私模式等）时退化为空 ID，放弃本次上报
    userId = '';
  }
  return userId;
}

/**
 * 批量上报到 POST /api/track，失败静默（仅 console.warn）
 */
async function sendBatch(events: UsageEventPayload[]): Promise<void> {
  const uid = getOrCreateUserId();
  if (!uid || events.length === 0) return;
  try {
    const res = await fetch('/api/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': uid,
      },
      body: JSON.stringify(events),
      keepalive: true,
    });
    if (!res.ok) {
      console.warn('[usage-tracker] 埋点上报失败:', res.status);
    }
  } catch (e) {
    console.warn('[usage-tracker] 埋点上报异常:', e);
  }
}

/** 安排 5s 定时批量发送（队列未满时到期触发） */
function scheduleFlush(): void {
  if (timer || !isClient()) return;
  timer = setTimeout(() => {
    timer = null;
    void flushNow();
  }, FLUSH_INTERVAL_MS);
}

/**
 * 记录一条用户行为事件（入队，异步批量上报，不阻塞调用方）
 */
export function trackEvent(event: UsageEventPayload): void {
  if (!isClient()) return;
  pending.push(event);
  if (pending.length >= QUEUE_LIMIT) {
    void flushNow();
  } else {
    scheduleFlush();
  }
}

/**
 * 立即发送缓冲队列（fire-and-forget）
 */
export async function flushNow(): Promise<void> {
  if (!isClient()) return;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  await sendBatch(batch);
}

/**
 * 上报当前页面访问（page_view）
 * 由 RouteTracker 组件在路由变化时调用；event_name 如 view_home / view_gz
 */
export function trackPageView(): void {
  if (!isClient()) return;
  const path = window.location.pathname || '/';
  const pageKey = path.replace(/\//g, '_').replace(/^_/, '') || 'home';
  trackEvent({
    event_type: 'page_view',
    event_name: `view_${pageKey}`,
    page_path: path,
  });
}

// 页面隐藏（切后台/关闭）时尽力发送缓冲中的事件
if (isClient()) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushNow();
    }
  });
}
