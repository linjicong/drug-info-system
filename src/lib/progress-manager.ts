/**
 * 抓取进度管理模块
 * 使用 globalThis 存储进度状态，避免 Next.js dev 热重载或路由 handler
 * 被独立加载时 POST/GET 读写到不同模块实例导致状态不同步
 * 支持 SSE 推送
 */

export interface FetchProgress {
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

export type ProgressSource = 'gz_drug' | 'gd_pubonln';

function createIdleProgress(): FetchProgress {
  return {
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
  };
}

type ProgressStore = Record<ProgressSource, FetchProgress>;
type SseClient = {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

declare global {
  // eslint-disable-next-line no-var
  var __fetchProgressStore__: ProgressStore | undefined;
  // eslint-disable-next-line no-var
  var __fetchProgressClients__: Set<SseClient> | undefined;
}

const globalStore = globalThis as typeof globalThis & {
  __fetchProgressStore__?: ProgressStore;
  __fetchProgressClients__?: Set<SseClient>;
};

function getStore(): ProgressStore {
  if (!globalStore.__fetchProgressStore__) {
    globalStore.__fetchProgressStore__ = {
      gz_drug: createIdleProgress(),
      gd_pubonln: createIdleProgress(),
    };
  }
  return globalStore.__fetchProgressStore__;
}

function getClients(): Set<SseClient> {
  if (!globalStore.__fetchProgressClients__) {
    globalStore.__fetchProgressClients__ = new Set<SseClient>();
  }
  return globalStore.__fetchProgressClients__;
}

/**
 * 获取当前进度
 */
export function getProgress(source: ProgressSource): FetchProgress {
  return { ...getStore()[source] };
}

/**
 * 更新进度
 */
export function updateProgress(source: ProgressSource, updates: Partial<FetchProgress>): void {
  const store = getStore();
  store[source] = { ...store[source], ...updates };
  broadcastProgress(source);
}

/**
 * 开始抓取
 */
export function startProgress(source: ProgressSource, totalPages: number): void {
  const store = getStore();
  store[source] = {
    status: 'running',
    currentPage: 0,
    totalPages,
    processedCount: 0,
    totalCount: 0,
    newCount: 0,
    updateCount: 0,
    startTime: Date.now(),
    endTime: null,
    error: null,
  };
  broadcastProgress(source);
}

/**
 * 完成抓取
 */
export function completeProgress(source: ProgressSource): void {
  const store = getStore();
  store[source].status = 'completed';
  store[source].endTime = Date.now();
  broadcastProgress(source);
}

/**
 * 设置错误
 */
export function setErrorProgress(source: ProgressSource, error: string): void {
  const store = getStore();
  store[source].status = 'error';
  store[source].error = error;
  store[source].endTime = Date.now();
  broadcastProgress(source);
}

/**
 * 重置进度
 */
export function resetProgress(source: ProgressSource): void {
  const store = getStore();
  store[source] = createIdleProgress();
  broadcastProgress(source);
}

/**
 * 广播进度到所有 SSE 客户端
 */
function broadcastProgress(source: ProgressSource): void {
  const data = `data: ${JSON.stringify(getStore()[source])}\n\n`;
  const encoded = new TextEncoder().encode(data);
  const clients = getClients();

  for (const client of clients) {
    try {
      client.controller.enqueue(encoded);
    } catch {
      // 客户端已断开，移除
      clients.delete(client);
    }
  }
}

/**
 * 添加 SSE 客户端
 */
export function addClient(source: ProgressSource, controller: ReadableStreamDefaultController): TextEncoder {
  const encoder = new TextEncoder();
  const client = { controller, encoder };
  getClients().add(client);

  // 立即发送当前进度
  const data = `data: ${JSON.stringify(getStore()[source])}\n\n`;
  controller.enqueue(encoder.encode(data));

  return encoder;
}

/**
 * 移除 SSE 客户端
 */
export function removeClient(controller: ReadableStreamDefaultController): void {
  const clients = getClients();
  for (const client of clients) {
    if (client.controller === controller) {
      clients.delete(client);
      break;
    }
  }
}

/**
 * 获取客户端数量
 */
export function getClientCount(): number {
  return getClients().size;
}
