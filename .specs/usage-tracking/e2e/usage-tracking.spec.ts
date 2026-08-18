import { test, expect, type Page } from '@playwright/test';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 收集页面发出的 /api/track 上报（请求拦截，不发真实修改） */
function collectTrackRequests(page: Page) {
  const requests: { postData: string; userHeader: string | null }[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/track') && req.method() === 'POST') {
      requests.push({
        postData: req.postData() ?? '',
        userHeader: req.headers()['x-user-id'] ?? null,
      });
    }
  });
  return requests;
}

async function flushAndCollect(page: Page, requests: ReturnType<typeof collectTrackRequests>) {
  await page.waitForTimeout(6500); // 等待 5s 批量 flush 定时器触发
  expect(requests.length).toBeGreaterThan(0);
  return requests;
}

test.describe('usage-tracking 6A Critical Path', () => {
  test('CP1+CP2: 首次访问生成匿名 ID 并上报 page_view，跨页复用 ID', async ({ page }) => {
    const requests = collectTrackRequests(page);

    // 清空 localStorage，模拟首次访问（addInitScript 每次页面加载都会执行，用 sessionStorage 标记只清第一次）
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('cleared-for-test')) {
        sessionStorage.setItem('cleared-for-test', '1');
        localStorage.removeItem('usage_user_id');
      }
    });

    // CP1: 访问首页
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await flushAndCollect(page, requests);

    const uid = await page.evaluate(() => localStorage.getItem('usage_user_id'));
    expect(uid).toMatch(UUID_RE);

    // 首页上报：event_type=page_view、page_path=/、X-User-Id=uid
    const first = JSON.parse(requests[0].postData);
    expect(Array.isArray(first)).toBe(true);
    expect(first.some((e: { event_type: string; page_path: string }) => e.event_type === 'page_view' && e.page_path === '/')).toBe(true);
    expect(requests[0].userHeader).toBe(uid);

    // CP2: 导航到 /gz（软导航），page_view 再次上报且 user_id 一致
    const beforeCount = requests.length;
    await page.goto('/gz', { waitUntil: 'domcontentloaded' });
    await flushAndCollect(page, requests);

    const uidAfter = await page.evaluate(() => localStorage.getItem('usage_user_id'));
    expect(uidAfter).toBe(uid); // ID 复用，未重新生成

    const newOnes = requests.slice(beforeCount);
    const gzEvents = newOnes.flatMap((r) => JSON.parse(r.postData));
    expect(gzEvents.some((e: { event_type: string; page_path: string }) => e.event_type === 'page_view' && e.page_path === '/gz')).toBe(true);
    expect(newOnes.some((r) => r.userHeader === uid)).toBe(true);
  });
});
