import { en, type MessageKey } from './en';

/**
 * The i18n hooks of the app (feature U29): every string a person reads in the shell goes through `t(key, params)`.
 * There is one catalog, English (`en.ts`); a translation is a partial catalog registered with `registerCatalog` and chosen with
 * `setLocale`. A key a translation lacks falls back to English, and a key the catalog lacks shows the key itself (a test keeps the
 * code and the catalog in step). Parameters are written `{name}`.
 */

export type { MessageKey };
export type Catalog = Partial<Record<MessageKey, string>>;

const catalogs = new Map<string, Catalog>([['en', en]]);
let locale = 'en';
const listeners = new Set<() => void>();

/** Registers (or replaces) the catalog of a locale; it may hold only the keys that are translated. */
export function registerCatalog(code: string, catalog: Catalog): void {
  catalogs.set(code, catalog);
  if (code === locale) notify();
}

export function setLocale(code: string): void {
  if (!catalogs.has(code)) throw new Error(`no catalog registered for the locale "${code}"`);
  locale = code;
  notify();
}

export const currentLocale = (): string => locale;
export const availableLocales = (): string[] => [...catalogs.keys()];

/** For `useSyncExternalStore`: components re-render when the locale or a catalog changes. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const notify = (): void => {
  for (const listener of [...listeners]) listener();
};

/** Replaces `{name}` placeholders; a placeholder without a parameter stays as it is. */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** The text of a key in the current locale (English when the locale lacks it), with the parameters filled in. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogs.get(locale)?.[key] ?? en[key] ?? key;
  return format(template, params);
}

/** For text the catalog does not hold by key, such as the strings of bpmn-js (`translate`): the English text is the key. */
export function translateText(text: string, params?: Record<string, string | number>): string {
  const bundle = catalogs.get(locale) as Record<string, string> | undefined;
  const template = bundle?.[text] ?? text;
  return format(template, params);
}
