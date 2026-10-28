/** A message below an entry, in the severities the properties panel knows. */
export interface Diagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export const error = (message: string): Diagnostic => ({ message, severity: 'error' });
export const warning = (message: string): Diagnostic => ({ message, severity: 'warning' });
export const info = (message: string): Diagnostic => ({ message, severity: 'info' });

/** True when the diagnostic must stop the value from being written (errors do, warnings and infos do not). */
export const blocksWrite = (d: Diagnostic | string | null | undefined): boolean => !!d && (typeof d === 'string' || d.severity === 'error');
