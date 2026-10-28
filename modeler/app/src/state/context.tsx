import { createContext, useContext, useSyncExternalStore } from 'react';

import type { AppController } from './controller';
import type { AppSnapshot } from './types';

export const ControllerContext = createContext<AppController | undefined>(undefined);

export function useController(): AppController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('useController outside of the app');
  return controller;
}

/** The current state of the app; the component re-renders when it changes. */
export function useAppState(): AppSnapshot {
  const controller = useController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
