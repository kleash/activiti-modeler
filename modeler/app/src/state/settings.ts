import { type StorageLike, safeLocalStorage } from './layout';

/**
 * The settings of the app (feature U19), kept in this browser. They change how the editor behaves, never what a file contains: a model
 * saved with one setting is the same model with another.
 */
export interface Settings {
  /** New user tasks, call activities and message catch events get `MAP_ALL` (a multi-instance user task `MAP_ALL_OUTPUTS`, ADR 0006), and so do converted Camunda 7 ones. */
  defaultMappings: 'mapAll' | 'none';
  /** A BPMN file without a diagram gets one when it is opened (feature U18). */
  autoLayout: boolean;
  /** The tabs, the visible tab and the layout of the last session come back when the app starts. */
  restoreSession: boolean;
  /** A file with Camunda 7 extensions shows the strip that offers the conversion (feature U17). */
  offerCamundaConversion: boolean;
  /** The language of the interface (feature U29); only English has a catalog. */
  locale: string;
}

export const SETTINGS_KEY = 'activiti-modeler.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  defaultMappings: 'mapAll',
  autoLayout: true,
  restoreSession: true,
  offerCamundaConversion: true,
  locale: 'en',
};

/** Makes any parsed JSON into valid settings: a value of the wrong type falls back to the default. */
export function sanitizeSettings(raw: unknown): Settings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bool = (key: 'autoLayout' | 'restoreSession' | 'offerCamundaConversion'): boolean => (typeof source[key] === 'boolean' ? (source[key] as boolean) : DEFAULT_SETTINGS[key]);
  return {
    defaultMappings: source['defaultMappings'] === 'none' || source['defaultMappings'] === 'mapAll' ? source['defaultMappings'] : DEFAULT_SETTINGS.defaultMappings,
    autoLayout: bool('autoLayout'),
    restoreSession: bool('restoreSession'),
    offerCamundaConversion: bool('offerCamundaConversion'),
    locale: typeof source['locale'] === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(source['locale']) ? source['locale'] : DEFAULT_SETTINGS.locale,
  };
}

export function loadSettings(storage: StorageLike | undefined = safeLocalStorage()): Settings {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : undefined);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: StorageLike | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // a full or blocked storage only costs the persistence
  }
}
