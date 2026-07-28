'use client';

/**
 * 药品模块 Hooks 入口
 * 保持 `@/components/drug/hooks` 导入路径不变，内部按职责拆分为多个子 Hook
 */
export { useDrugModule } from './use-drug-module';
export { useDrugQuery, type UseDrugQueryOptions } from './use-drug-query';
export {
  useProgressPolling,
  type ProgressLike,
  type UseProgressPollingOptions,
} from './use-progress-polling';
export { useScheduler, type UseSchedulerOptions } from './use-scheduler';
export {
  buildModuleQueryStorageKey,
  buildProgressStorageKey,
  readModuleQueryState,
  readSessionJson,
  type ModuleQueryState,
} from './storage';
