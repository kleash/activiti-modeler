import type { ProjectFileData } from '@activiti-modeler/activiti-project';
import { classifyFile } from '@activiti-modeler/activiti-project';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeEditor, type CodeDiagnostic } from '../editors/CodeEditor';
import { t } from '../i18n';
import type { EditorProps } from '../state/types';
import { useConnection, useScenarioResults } from './hooks';
import { runService } from './runService';
import { ScenarioForm, type FormSuggestions } from './ScenarioForm';
import { ScenarioReportView } from './ScenarioReportView';
import { checkScenarioText } from './scenarioSchema';

const WORKING_COPY_DELAY_MS = 500;
type View = 'both' | 'form' | 'json';

/** Ids of the flow nodes and process keys of the project, and the users the scenario files know, for the suggestions of the form. */
export function suggestionsFor(paths: string[], read: (path: string) => string | undefined): FormSuggestions {
  const activities = new Set<string>();
  const processes = new Set<string>();
  const users = new Set<string>();
  const NODE = /<(?:\w+:)?(userTask|serviceTask|scriptTask|sendTask|receiveTask|manualTask|businessRuleTask|task|callActivity|subProcess|transaction|startEvent|endEvent|intermediateCatchEvent|intermediateThrowEvent|boundaryEvent|exclusiveGateway|parallelGateway|inclusiveGateway|eventBasedGateway)\b[^>]*?\bid="([^"]+)"/g;
  for (const path of paths) {
    const kind = classifyFile(path);
    const text = read(path) ?? '';
    if (kind === 'bpmn') {
      for (const m of text.matchAll(/<(?:\w+:)?process\b[^>]*?\bid="([^"]+)"/g)) processes.add(m[1]!);
      for (const m of text.matchAll(NODE)) activities.add(m[2]!);
    } else if (kind === 'scenario') {
      try {
        for (const name of Object.keys((JSON.parse(text) as { users?: Record<string, unknown> }).users ?? {})) users.add(name);
      } catch {
        // an unreadable scenario file offers no users
      }
    }
  }
  return { activities: [...activities].sort(), processes: [...processes].sort(), users: [...users].sort() };
}

/**
 * The editor of `scenarios/*.scenario.json` (R6): a structured form and the JSON side by side, checked against the scenario schema
 * (`schemas/scenario.schema.json`), with a Run button that plays the scenario on the connected server and shows the report.
 */
export function ScenarioTabEditor({ tab, host, active }: EditorProps) {
  const ws = host.workspace;
  const initial = useMemo(() => ws.model.read(tab.path) ?? '', [ws, tab.path]);
  const [text, setText] = useState(initial);
  const textRef = useRef(initial);
  const pathRef = useRef(tab.path);
  pathRef.current = tab.path;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [view, setView] = useState<View>('both');
  const conn = useConnection();
  const results = useScenarioResults();
  const record = results.records.get(tab.path);

  const checked = useMemo(() => checkScenarioText(text), [text]);
  const diagnostics: CodeDiagnostic[] = checked.diagnostics;
  const value = checked.value !== null && typeof checked.value === 'object' && !Array.isArray(checked.value) ? (checked.value as Record<string, unknown>) : undefined;
  const revision = ws.model.revision;
  // recomputed when the files of the project change (the model's revision), which is not read inside
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggestions = useMemo(() => suggestionsFor(ws.model.paths(), (p) => ws.model.read(p)), [ws, revision]);

  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    const path = pathRef.current;
    if (ws.model.has(path) || ws.model.isDirty(path)) await ws.edit(path, textRef.current);
  };

  const apply = (next: string): void => {
    textRef.current = next;
    setText(next);
    host.setDirty(next !== ws.model.saved(pathRef.current));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), WORKING_COPY_DELAY_MS);
  };

  useEffect(() => {
    host.setHandle({
      async serialize(target: string): Promise<ProjectFileData[]> {
        return [{ path: target, content: textRef.current }];
      },
      markSaved: () => host.setDirty(false),
      focus: () => document.querySelector<HTMLElement>('.editor-panel.active .cm-content')?.focus(),
    });
    host.setDirty(ws.model.isDirty(tab.path));
    return () => {
      clearTimeout(timer.current);
      host.setHandle(undefined);
    };
    // the handle reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active && view !== 'form') document.querySelector<HTMLElement>('.editor-panel.active .cm-content')?.focus();
  }, [active, view]);

  const problems = diagnostics.filter((d) => d.severity === 'error');
  const run = (): void => {
    // the report appears under the editor; the Scenarios tab of the run view keeps the same record
    void flush().then(() => runService.runScenario(tab.path, textRef.current));
  };

  return (
    <div className="scenario-editor" data-testid="scenario-editor">
      <div className="scenario-toolbar">
        <div role="tablist" className="view-switch inline" aria-label={t('run.scenario.viewAs')}>
          {(['both', 'form', 'json'] as View[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'selected' : ''} onClick={() => setView(v)} data-testid={`scenario-view-${v}`}>
              {v === 'both' ? t('run.scenario.viewBoth') : v === 'form' ? t('run.scenario.viewForm') : t('run.scenario.viewJson')}
            </button>
          ))}
        </div>
        <span className={problems.length === 0 ? 'muted small' : 'field-error small'} data-testid="scenario-schema-status">
          {problems.length === 0 ? t('run.scenario.valid') : t(problems.length === 1 ? 'run.scenario.problems.one' : 'run.scenario.problems.other', { count: problems.length })}
        </span>
        <span className="spacer" />
        <button type="button" className="btn small primary" disabled={record?.running || value === undefined} onClick={run} data-testid="scenario-run" title={conn.status === 'connected' ? t('run.scenario.runTitle') : t('run.scenario.needsConnection')}>
          {record?.running ? t('run.scenario.running') : t('run.scenario.run')}
        </button>
      </div>
      <div className={`scenario-split ${view}`}>
        {view !== 'json' && (
          <div className="scenario-form-pane">
            {value ? (
              <ScenarioForm value={value} suggestions={suggestions} onChange={(next) => apply(`${JSON.stringify(next, null, 2)}\n`)} />
            ) : (
              <p className="notice" role="note">{t('run.scenario.needsObject')}</p>
            )}
          </div>
        )}
        {view !== 'form' && (
          <div className="scenario-json-pane">
            <CodeEditor value={text} language="json" label={t('run.scenario.source', { title: tab.title })} testId="scenario-json" diagnostics={diagnostics} onChange={apply} />
          </div>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="run-list problems schema-problems" data-testid="scenario-schema-problems">
          {problems.slice(0, 6).map((d, i) => (
            <li key={i} className="error">{d.message}</li>
          ))}
          {problems.length > 6 && <li className="muted">{t('run.scenario.more', { count: problems.length - 6 })}</li>}
        </ul>
      )}
      {record && (
        <div className="scenario-editor-report">
          <ScenarioReportView record={record} workspace={ws} />
        </div>
      )}
    </div>
  );
}
