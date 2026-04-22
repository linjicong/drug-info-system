/**
 * 抓取进度管理模块
 * 使用内存存储进度状态，支持 SSE 推送
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

// 按数据源维护独立进度状态
const progressBySource: Record<ProgressSource, FetchProgress> = {
  gz_drug: createIdleProgress(),
  gd_pubonln: createIdleProgress(),
};

// SSE 客户端连接列表
const clients = new Set<{
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
}>();

/**
 * 获取当前进度
 */
export function getProgress(source: ProgressSource): FetchProgress {
  return { ...progressBySource[source] };
}

/**
 * 更新进度
 */
export function updateProgress(source: ProgressSource, updates: Partial<FetchProgress>): void {
  progressBySource[source] = { ...progressBySource[source], ...updates };
  broadcastProgress(source);
}

/**
 * 开始抓取
 */
export function startProgress(source: ProgressSource, totalPages: number): void {
  progressBySource[source] = {
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
  progressBySource[source].status = 'completed';
  progressBySource[source].endTime = Date.now();
  broadcastProgress(source);
}

/**
 * 设置错误
 */
export function setErrorProgress(source: ProgressSource, error: string): void {
  progressBySource[source].status = 'error';
  progressBySource[source].error = error;
  progressBySource[source].endTime = Date.now();
  broadcastProgress(source);
}

/**
 * 重置进度
 */
export function resetProgress(source: ProgressSource): void {
  progressBySource[source] = createIdleProgress();
  broadcastProgress(source);
}

/**
 * 广播进度到所有 SSE 客户端
 */
function broadcastProgress(source: ProgressSource): void {
  const data = `data: ${JSON.stringify(progressBySource[source])}\n\n`;
  const encoded = new TextEncoder().encode(data);
  
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
  clients.add(client);
  
  // 立即发送当前进度
  const data = `data: ${JSON.stringify(progressBySource[source])}\n\n`;
  controller.enqueue(encoder.encode(data));
  
  return encoder;
}

/**
 * 移除 SSE 客户端
 */
export function removeClient(controller: ReadableStreamDefaultController): void {
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
  return clients.size;
}
