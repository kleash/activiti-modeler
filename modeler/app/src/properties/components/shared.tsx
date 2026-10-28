/** @jsxImportSource @bpmn-io/properties-panel/preact */
import { DiagnosticMessage, DescriptionEntry, TooltipEntry, useDiagnostics, type PanelDiagnostic } from '@bpmn-io/properties-panel';
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';

import type { Diagnostic } from '../validation/types';

export type { Diagnostic };

const RANK = { info: 0, warning: 1, error: 2 } as const;

/** The most severe of the diagnostics (a plain string counts as an error), or null. */
export function mostSevere(...values: Array<Diagnostic | PanelDiagnostic | string | null | undefined>): PanelDiagnostic | null {
  let best: PanelDiagnostic | null = null;
  for (const value of values) {
    if (!value) continue;
    const d: PanelDiagnostic = typeof value === 'string' ? { message: value, severity: 'error' } : value;
    if (!best || RANK[d.severity] > RANK[best.severity]) best = d;
  }
  return best;
}

export const severityClass = (d: PanelDiagnostic | null): string => (d?.severity === 'error' ? 'has-error' : d?.severity === 'warning' ? 'has-warning' : '');

interface ShellProps {
  id: string;
  element: unknown;
  diagnostic?: PanelDiagnostic | null;
  description?: ComponentChildren;
  className?: string;
  children: ComponentChildren;
}

/** The frame every entry of the panel has: the entry class, its id for `propertiesPanel.showEntry`, the message and the description. */
export function EntryShell({ id, element, diagnostic, description, className, children }: ShellProps) {
  return (
    <div class={`bio-properties-panel-entry ${className ?? ''} ${severityClass(diagnostic ?? null)}`.trim()} data-entry-id={id}>
      {children}
      <DiagnosticMessage diagnostic={diagnostic} forId={id} element={element} />
      <DescriptionEntry forId={id} element={element} value={description} />
    </div>
  );
}

/** The label of an entry, with the tooltip when there is one. */
export function EntryLabel({ id, label, tooltip, element, htmlFor }: { id: string; label: ComponentChildren; tooltip?: ComponentChildren; element: unknown; htmlFor?: string }) {
  return (
    <label for={htmlFor ?? `bio-properties-panel-${id}`} class="bio-properties-panel-label">
      <TooltipEntry value={tooltip} forId={id} element={element}>
        {label}
      </TooltipEntry>
    </label>
  );
}

/** Diagnostics from outside the entry (`propertiesPanel.setDiagnostics`) joined with the local one. */
export function useEntryDiagnostic(id: string, local: Diagnostic | PanelDiagnostic | null | undefined): PanelDiagnostic | null {
  return mostSevere(...useDiagnostics(id), local);
}

/** True when a diagnostic stops a value from being written. */
export const blocks = (d: Diagnostic | PanelDiagnostic | string | null | undefined): boolean => !!d && (typeof d === 'string' || d.severity === 'error');
