import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { ModdleLike, VariableUse } from '@activiti-modeler/activiti-variable-resolver';

import { t } from '../i18n';
import { getActiveModeler, subscribeActiveModeler } from '../modelerRegistry';
import { useAppState } from '../state/context';
import type { ActivitiVariable } from './ActivitiVariableResolver';
import './variables.css';

interface BusLike {
  on(events: string | string[], handler: (event: unknown) => void): void;
  off(events: string | string[], handler: (event: unknown) => void): void;
}
interface ResolverLike {
  getVariables(): Promise<Record<string, ActivitiVariable[]>>;
}
interface CanvasLike {
  addMarker(element: unknown, marker: string): void;
  removeMarker(element: unknown, marker: string): void;
  scrollToElement?(element: unknown): void;
  getRootElement(): unknown;
}
interface RegistryLike {
  get(id: string): unknown;
}

export const WRITER_MARKER = 'activiti-var-writer';
export const READER_MARKER = 'activiti-var-reader';
const REFRESH_EVENTS = ['import.done', 'commandStack.changed', 'activiti.extensions.changed', 'activiti.project.changed', 'variables.changed', 'selection.changed'];

export interface VariableRow {
  key: string;
  processId: string;
  variable: ActivitiVariable;
  scopeLabel: string;
}

interface ModelerLike {
  get<T>(name: string): T;
}

const labelOf = (el: ModdleLike): string => {
  const name = el.get('name');
  return typeof name === 'string' && name ? name : (el.id ?? el.$type);
};

/** The variables of the process(es) of a modeler, as rows (process variables first). */
export async function readRows(modeler: ModelerLike): Promise<VariableRow[]> {
  const resolver = modeler.get<ResolverLike>('variableResolver');
  const all = await resolver.getVariables();
  const rows: VariableRow[] = [];
  for (const [processId, variables] of Object.entries(all)) {
    for (const variable of variables as ActivitiVariable[]) {
      const scope = variable.scope as ModdleLike | undefined;
      const local = !!scope && scope.id !== processId;
      rows.push({ key: `${processId}/${variable.name}/${local ? scope!.id : ''}`, processId, variable, scopeLabel: local ? t('variables.localScope', { element: labelOf(scope!) }) : t('variables.processScope') });
    }
  }
  return rows;
}

/** Marks the writers and readers of a variable on the canvas; returns the function that takes the markers away again. */
export function highlight(modeler: ModelerLike, variable: ActivitiVariable): () => void {
  const canvas = modeler.get<CanvasLike>('canvas');
  const registry = modeler.get<RegistryLike>('elementRegistry');
  const marked: Array<{ element: unknown; marker: string }> = [];
  const mark = (uses: VariableUse[], marker: string): void => {
    for (const use of uses) {
      const element = use.element.id ? registry.get(use.element.id) : undefined;
      // the process itself (declared variables) has no shape to mark
      if (!element || element === canvas.getRootElement()) continue;
      canvas.addMarker(element, marker);
      marked.push({ element, marker });
    }
  };
  mark(variable.uses.writers, WRITER_MARKER);
  mark(variable.uses.readers, READER_MARKER);
  return () => {
    for (const { element, marker } of marked) {
      try {
        canvas.removeMarker(element, marker);
      } catch {
        // the element is gone
      }
    }
  };
}

function UseChips({ modeler, uses, kind, empty }: { modeler: ModelerLike; uses: VariableUse[]; kind: 'writer' | 'reader'; empty: string }) {
  if (uses.length === 0) return <span className="muted">{empty}</span>;
  const select = (use: VariableUse): void => {
    const registry = modeler.get<RegistryLike>('elementRegistry');
    const canvas = modeler.get<CanvasLike>('canvas');
    const element = use.element.id ? registry.get(use.element.id) : undefined;
    const target = element ?? canvas.getRootElement();
    modeler.get<{ select(element: unknown): void }>('selection').select(target);
    if (element) canvas.scrollToElement?.(element);
  };
  const seen = new Set<string>();
  return (
    <>
      {uses.filter((u) => !seen.has(`${u.element.id}`) && seen.add(`${u.element.id}`)).map((use) => (
        <button key={`${use.element.id}${use.detail}`} type="button" className={`variable-chip ${kind}`} title={use.detail} onClick={(event) => { event.stopPropagation(); select(use); }} data-testid={`variable-${kind}`} data-element={use.element.id}>
          {use.element.$instanceOf('bpmn:Process') ? t('variables.processElement') : labelOf(use.element)}
        </button>
      ))}
    </>
  );
}

/** The variable outline (feature U14): the variables of the open process, who writes and who reads them; a row highlights them on the canvas. */
export function VariablesPanel() {
  const state = useAppState();
  const modeler = useSyncExternalStore(subscribeActiveModeler, getActiveModeler) as ModelerLike | undefined;
  const tab = state.tabs.find((x) => x.id === state.activeTabId);
  const showing = !!modeler && !!tab && tab.editor === 'bpmn' && !tab.error;
  const [rows, setRows] = useState<VariableRow[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);

  useEffect(() => {
    if (!showing || !modeler) {
      setRows([]);
      return undefined;
    }
    const bus = modeler.get<BusLike>('eventBus');
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (): void => {
      void readRows(modeler)
        .then((next) => {
          if (disposed) return;
          setRows(next);
          setSelection(modeler.get<{ get(): Array<{ id: string }> }>('selection').get().map((e) => e.id));
        })
        .catch(() => undefined);
    };
    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 60);
    };
    refresh();
    bus.on(REFRESH_EVENTS, schedule);
    return () => {
      disposed = true;
      clearTimeout(timer);
      bus.off(REFRESH_EVENTS, schedule);
    };
  }, [modeler, showing, tab?.path]);

  const current = rows.find((r) => r.key === selected);
  // the markers follow the chosen variable and are gone when the panel is, the variable or the diagram changes
  useEffect(() => {
    if (!modeler || !current) return undefined;
    return highlight(modeler, current.variable);
  }, [modeler, current]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return rows.filter((row) => {
      if (needle && !row.variable.name.toLowerCase().includes(needle)) return false;
      if (!selectedOnly) return true;
      if (selection.length === 0) return false;
      const touches = (uses: VariableUse[]): boolean => uses.some((u) => u.element.id && selection.includes(u.element.id));
      return touches(row.variable.uses.writers) || touches(row.variable.uses.readers);
    });
  }, [rows, filter, selectedOnly, selection]);

  if (!showing || !modeler) return <p className="muted" data-testid="variables-none">{t('variables.noProcess')}</p>;

  return (
    <div className="variables" data-testid="variables-panel">
      <div className="variables-toolbar">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('variables.filterPlaceholder')} aria-label={t('variables.filter')} data-testid="variables-filter" />
        <label>
          <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} data-testid="variables-selected-only" /> {t('variables.selectedOnly')}
        </label>
        <span className="spacer" />
        <span className="muted small">{t('variables.legend')}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted variables-empty" data-testid="variables-empty">{t('variables.empty')}</p>
      ) : (
        <table className="variables-table">
          <thead>
            <tr>
              <th scope="col">{t('variables.name')}</th>
              <th scope="col">{t('variables.type')}</th>
              <th scope="col">{t('variables.scope')}</th>
              <th scope="col">{t('variables.writers')}</th>
              <th scope="col">{t('variables.readers')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.key}
                className={row.key === selected ? 'selected' : ''}
                aria-selected={row.key === selected}
                tabIndex={0}
                title={t('variables.highlight')}
                onClick={() => setSelected(row.key === selected ? undefined : row.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(row.key === selected ? undefined : row.key);
                  }
                }}
                data-testid="variable-row"
                data-name={row.variable.name}
                data-scope={row.variable.scope && (row.variable.scope as { id?: string }).id !== row.processId ? (row.variable.scope as { id?: string }).id : ''}
              >
                <td>
                  <code>{row.variable.name}</code>
                  {row.variable.external && <span className="variable-flag warning" title={t('variables.external')}> ?</span>}
                </td>
                <td>{row.variable.valueType ?? <span className="muted">—</span>}</td>
                <td>{row.scopeLabel}</td>
                <td><UseChips modeler={modeler} uses={row.variable.uses.writers} kind="writer" empty={t('variables.noWriters')} /></td>
                <td><UseChips modeler={modeler} uses={row.variable.uses.readers} kind="reader" empty={t('variables.noReaders')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
