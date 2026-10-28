import { useSyncExternalStore } from 'react';

import { lintService, type LintSnapshot } from './LintService';

/** The problems of the open project; the component re-renders when they change. */
export function useLint(): LintSnapshot {
  return useSyncExternalStore(lintService.subscribe, lintService.getSnapshot);
}
