'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView } from '@/lib/usage-tracker';

/**
 * 路由访问埋点组件（挂载于根布局）
 * usePathname 首次挂载与每次路由变化均触发上报（useEffect 仅在客户端执行，
 * 规避 SSR/hydration 差异）；不含 query 参数，避免查询词进入 page_view。
 */
export function RouteTracker() {
  const pathname = usePathname();

  useEffect(() => {
    trackPageView();
  }, [pathname]);

  return null;
}
