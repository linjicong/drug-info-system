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

// 全局进度状态
let currentProgress: FetchProgress = {
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

// SSE 客户端连接列表
const clients = new Set<{
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
}>();

/**
 * 获取当前进度
 */
export function getProgress(): FetchProgress {
  return { ...currentProgress };
}

/**
 * 更新进度
 */
export function updateProgress(updates: Partial<FetchProgress>): void {
  currentProgress = { ...currentProgress, ...updates };
  broadcastProgress();
}

/**
 * 开始抓取
 */
export function startProgress(totalPages: number): void {
  currentProgress = {
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
  broadcastProgress();
}

/**
 * 完成抓取
 */
export function completeProgress(): void {
  currentProgress.status = 'completed';
  currentProgress.endTime = Date.now();
  broadcastProgress();
}

/**
 * 设置错误
 */
export function setErrorProgress(error: string): void {
  currentProgress.status = 'error';
  currentProgress.error = error;
  currentProgress.endTime = Date.now();
  broadcastProgress();
}

/**
 * 重置进度
 */
export function resetProgress(): void {
  currentProgress = {
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
  broadcastProgress();
}

/**
 * 广播进度到所有 SSE 客户端
 */
function broadcastProgress(): void {
  const data = `data: ${JSON.stringify(currentProgress)}\n\n`;
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
export function addClient(controller: ReadableStreamDefaultController): TextEncoder {
  const encoder = new TextEncoder();
  const client = { controller, encoder };
  clients.add(client);
  
  // 立即发送当前进度
  const data = `data: ${JSON.stringify(currentProgress)}\n\n`;
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
