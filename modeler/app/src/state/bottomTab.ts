/** Which tab of the bottom panel is asked for (a menu command, the status bar): the panel follows the latest request. */
export type BottomTabId = 'warnings' | 'problems' | 'variables';

let latest: { tab: BottomTabId; serial: number } = { tab: 'warnings', serial: 0 };
const listeners = new Set<() => void>();

export function requestBottomTab(tab: BottomTabId): void {
  latest = { tab, serial: latest.serial + 1 };
  for (const listener of [...listeners]) listener();
}

export const bottomTabRequest = (): { tab: BottomTabId; serial: number } => latest;

export function subscribeBottomTab(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
