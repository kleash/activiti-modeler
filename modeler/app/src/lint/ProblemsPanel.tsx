import { useMemo, useState } from 'react';

import type { Problem, Severity } from '@activiti-modeler/bpmnlint-plugin-activiti';

import { useAppState, useController } from '../state/context';
import './lint.css';
import { lintService } from './LintService';
import { useLint } from './useLint';

const SEVERITIES: Array<{ id: Severity; label: string; icon: string }> = [
  { id: 'error', label: 'Errors', icon: '✕' },
  { id: 'warning', label: 'Warnings', icon: '!' },
  { id: 'info', label: 'Notes', icon: 'i' },
];

const CURRENT = '@current';

const elementLabel = (p: Problem): string => (p.elementId ? p.elementId : 'file');
const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The Problems tab of the bottom panel (feature U11): the list, the filters, click to select + focus the field, quick fixes. */
export function ProblemsPanel() {
  const lint = useLint();
  const state = useAppState();
  const controller = useController();
  const [shown, setShown] = useState<Record<Severity, boolean>>({ error: true, warning: true, info: true });
  const [scope, setScope] = useState<string>('');
  const activePath = state.tabs.find((t) => t.id === state.activeTabId)?.path;

  const visible = useMemo(
    () =>
      lint.problems.filter((p) => {
        if (!shown[p.severity]) return false;
        if (scope === CURRENT) return p.path === activePath;
        return scope === '' || p.path === scope;
      }),
    [lint.problems, shown, scope, activePath],
  );

  const toggle = (severity: Severity): void => setShown((s) => ({ ...s, [severity]: !s[severity] }));

  const applyFix = async (problem: Problem): Promise<void> => {
    const result = await lintService.fix(problem);
    if (result.ok) controller.toast(`${problem.fix?.label ?? 'Fixed'}: done (undo with ${controller.isMac ? '⌘Z' : 'Ctrl+Z'})`, 'success');
  };

  const validate = async (): Promise<void> => {
    try {
      const problems = await lintService.validateOnServer();
      controller.toast(`The server reported ${problems.length} problem(s)`, problems.some((p) => p.severity === 'error') ? 'error' : 'success');
    } catch (e) {
      controller.toast('The server validation failed', 'error', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="problems" data-testid="problems-panel">
      <div className="problems-toolbar">
        <div role="group" aria-label="Show problems of severity" className="problems-filters">
          {SEVERITIES.map((s) => (
            <button key={s.id} type="button" className={`problems-filter ${s.id}`} aria-pressed={shown[s.id]} data-testid={`filter-${s.id}`} onClick={() => toggle(s.id)}>
              <span className="problem-icon" aria-hidden="true">{s.icon}</span> {s.label} ({lint.counts[s.id]})
            </button>
          ))}
        </div>
        <label className="problems-scope">
          File{' '}
          <select value={scope} onChange={(e) => setScope(e.target.value)} data-testid="problems-file">
            <option value="">All files ({lint.files.length})</option>
            <option value={CURRENT}>The open file</option>
            {lint.files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {lint.server.available && (
          <button type="button" className="problems-server" onClick={() => void validate()} disabled={lint.server.status === 'running'} data-testid="validate-server" title="Check the project with the engine of the modeler server (POST /api/dev/validate)">
            {lint.server.status === 'running' ? 'Validating…' : 'Validate on server'}
          </button>
        )}
        <span className="muted problems-status" data-testid="problems-status">
          {lint.linting ? 'Linting…' : lint.problems.length === 0 ? 'No problems' : `${visible.length} of ${lint.problems.length} shown`}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="muted problems-empty" data-testid="problems-empty">
          {lint.problems.length === 0 ? 'No problems found in the project.' : 'No problems match the filters.'}
        </p>
      ) : (
        <ul className="problem-list" data-testid="problem-list" aria-label="Problems">
          {visible.map((p) => (
            <li key={p.id} className={`problem ${p.severity}`} data-testid="problem" data-rule={p.rule} data-element={p.elementId ?? ''} data-severity={p.severity} data-path={p.path} data-source={p.source} data-key={p.key ?? ''}>
              <button type="button" className="problem-main" onClick={() => void lintService.open(p)} title="Select the element and show its field">
                <span className={`problem-icon ${p.severity}`} aria-hidden="true">{SEVERITIES.find((s) => s.id === p.severity)?.icon}</span>
                <span className="problem-message">{p.message}</span>
              </button>
              <span className="problem-where" title={p.path}>
                {base(p.path)} · {elementLabel(p)}
              </span>
              {p.source === 'engine' && <span className="problem-badge" title="Reported by the Activiti engine of the modeler server">engine</span>}
              {p.documentationUrl ? (
                <a className="problem-rule" href={p.documentationUrl} target="_blank" rel="noreferrer">
                  {p.rule}
                </a>
              ) : (
                <span className="problem-rule">{p.rule}</span>
              )}
              {p.fix && classify(p) && (
                <button type="button" className="problem-fix" data-testid="problem-fix" onClick={() => void applyFix(p)} title={p.fix.label}>
                  Fix: {p.fix.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Quick fixes need the diagram editor, so they are offered for processes only. */
const classify = (p: Problem): boolean => /\.(bpmn20\.xml|bpmn)$/.test(p.path);
