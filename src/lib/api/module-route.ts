import { NextRequest, NextResponse } from 'next/server';

type RouteHandler = (request: NextRequest) => Promise<Response> | Response;
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type MethodMap = Partial<Record<HttpMethod, RouteHandler>>;
type RouteContext = { params: Promise<{ action?: string[] }> };

/**
 * 页面模块路由工厂：一个 [[...action]]/route.ts 覆盖模块下全部子路径
 *
 * 分发表 key 为子路径（'' 表示模块根路径，多级用 '/' 连接，如 'sync/progress'），
 * value 为该子路径支持的方法 → handler 映射。
 * 未知子路径返回 404；子路径存在但方法不支持返回 405。
 */
export function createModuleRoute(routes: Record<string, MethodMap>) {
  function dispatch(method: HttpMethod) {
    return async function handler(request: NextRequest, context: RouteContext) {
      const { action } = await context.params;
      const path = (action ?? []).join('/');
      const methods = routes[path];

      if (!methods) {
        return NextResponse.json({ error: '接口不存在' }, { status: 404 });
      }

      const matched = methods[method];
      if (!matched) {
        return NextResponse.json(
          { error: `此端点仅支持 ${Object.keys(methods).join(' / ')} 请求` },
          { status: 405 }
        );
      }

      return matched(request);
    };
  }

  return {
    GET: dispatch('GET'),
    POST: dispatch('POST'),
    PUT: dispatch('PUT'),
    DELETE: dispatch('DELETE'),
  };
}
