import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { connection, type ConnectionSnapshot } from './connection';
import { recorder, type RecorderSnapshot } from './recorder';
import { runService, type RunSnapshot } from './runService';
import { scenarioResults, type ScenarioResultsSnapshot } from './scenarioStore';

export function useConnection(): ConnectionSnapshot {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}

export function useRecorder(): RecorderSnapshot {
  return useSyncExternalStore(recorder.subscribe, recorder.getSnapshot);
}

export function useRun(): RunSnapshot {
  return useSyncExternalStore(runService.subscribe, runService.getSnapshot);
}

export interface Polled<T> {
  data: T | undefined;
  error: string | undefined;
  /** True until the first answer. */
  loading: boolean;
  reload(): Promise<void>;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Loads `fetcher()` now and then every `intervalMs` while `enabled` (live refresh by polling). A new `key` loads again from scratch;
 * answers of a stale key are dropped. The last good data stays while a refresh fails (the error is reported next to it).
 */
export function usePolled<T>(fetcher: () => Promise<T>, key: string, intervalMs: number, enabled = true): Polled<T> {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const keyRef = useRef(key);
  keyRef.current = key;

  const load = useCallback(async (forKey: string): Promise<void> => {
    try {
      const value = await fetcherRef.current();
      if (keyRef.current !== forKey) return;
      setData(value);
      setError(undefined);
    } catch (e) {
      if (keyRef.current !== forKey) return;
      setError(message(e));
    } finally {
      if (keyRef.current === forKey) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    setLoading(true);
    if (!enabled) return undefined;
    let stopped = false;
    void load(key);
    const timer = intervalMs > 0 ? setInterval(() => !stopped && void load(key), intervalMs) : undefined;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [key, intervalMs, enabled, load]);

  const reload = useCallback(() => load(keyRef.current), [load]);
  return { data, error, loading, reload };
}

export function useScenarioResults(): ScenarioResultsSnapshot {
  return useSyncExternalStore(scenarioResults.subscribe, scenarioResults.getSnapshot);
}
