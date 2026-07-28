/**
 * 进度存储工厂
 * 使用 globalThis 存储进度状态，避免 Next.js dev 热重载或路由 handler
 * 被独立加载时 POST/GET 读写到不同模块实例导致状态不同步
 */
export function createProgressStore<P>(globalKey: string, createInitial: () => P) {
  const globalStore = globalThis as Record<string, unknown>;

  return {
    /** 获取可变引用（惰性初始化） */
    ref(): P {
      if (!globalStore[globalKey]) {
        globalStore[globalKey] = createInitial();
      }
      return globalStore[globalKey] as P;
    },
    /** 整体替换 */
    set(next: P): void {
      globalStore[globalKey] = next;
    },
    /** 重置为初始状态 */
    reset(): void {
      globalStore[globalKey] = createInitial();
    },
  };
}
