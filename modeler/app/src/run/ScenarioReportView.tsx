import { overlaysForVisits } from '@activiti-modeler/activiti-diagram-viewer';
import { classifyFile, type ProjectWorkspace } from '@activiti-modeler/activiti-project';
import type { ScenarioReport, StepReport } from '@activiti-modeler/runtime-client';
import { useMemo, useState } from 'react';

import { t, type MessageKey } from '../i18n';
import { DiagramPane } from './DiagramPane';
import type { ScenarioRunRecord } from './scenarioStore';

const ICON: Record<string, MessageKey> = { PASSED: 'run.report.ok', FAILED: 'run.report.fail', SKIPPED: 'run.report.skip' };

/** Process key -> the BPMN text of the file that declares it. */
export function processSources(workspace: ProjectWorkspace): Map<string, string> {
  const sources = new Map<string, string>();
  for (const path of workspace.model.paths()) {
    if (classifyFile(path) !== 'bpmn') continue;
    const xml = workspace.model.read(path) ?? '';
    for (const match of xml.matchAll(/<(?:\w+:)?process\b[^>]*?\bid="([^"]+)"/g)) sources.set(match[1]!, xml);
  }
  return sources;
}

function StepRow({ step }: { step: StepReport }) {
  const status = step.status ?? 'PASSED';
  const icon = ICON[status];
  return (
    <li className={`step step-${status.toLowerCase()}`} data-testid={`step-${step.index ?? 'start'}`} data-status={status}>
      <span className="step-status" aria-label={status}>[{icon ? t(icon) : status}]</span>{' '}
      <span>{step.description}</span>
      {step.durationMs !== undefined && step.durationMs > 50 ? <span className="muted small"> {t('run.report.ms', { ms: step.durationMs })}</span> : null}
      {step.message && <div className="field-error small step-message">{step.message}</div>}
    </li>
  );
}

function ScenarioCard({ scenario, selected, onSelect }: { scenario: ScenarioReport; selected: boolean; onSelect(): void }) {
  const status = scenario.status ?? 'PASSED';
  return (
    <article className={`scenario-card status-${status.toLowerCase()}${selected ? ' selected' : ''}`} data-testid={`scenario-result-${scenario.name}`} data-status={status}>
      <header>
        <button type="button" className="link" onClick={onSelect} title={t('run.report.showPath')}>
          <strong>{scenario.name}</strong>
        </button>{' '}
        <span className={`state state-${status === 'PASSED' ? 'completed' : status === 'FAILED' ? 'cancelled' : 'suspended'}`}>{status}</span>
        {scenario.durationMs !== undefined && <span className="muted small"> {t('run.report.ms', { ms: scenario.durationMs })}</span>}
      </header>
      <ul className="steps">
        {(scenario.steps ?? []).map((step, i) => (
          <StepRow key={i} step={step} />
        ))}
      </ul>
      {(scenario.failures ?? []).length > 0 && (
        <ul className="run-list problems" data-testid="scenario-failures">
          {(scenario.failures ?? []).map((f, i) => (
            <li key={i} className="error">{f}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** The result of a scenario run (R6): pass/fail per scenario and step, the failures, and the path the scenario took on the diagram. */
export function ScenarioReportView({ record, workspace }: { record: ScenarioRunRecord; workspace: ProjectWorkspace | undefined }) {
  const [picked, setPicked] = useState<string | undefined>();
  const [processKey, setProcessKey] = useState<string | undefined>();
  const [raw, setRaw] = useState(false);
  const response = record.response;
  const scenarios = response?.report.scenarios ?? [];
  const selectedName = picked ?? scenarios.find((s) => s.status === 'FAILED')?.name ?? scenarios[0]?.name;
  const selected = scenarios.find((s) => s.name === selectedName);
  const visited = selected?.visited ?? response?.report.visited;
  const keys = Object.keys(visited?.byProcess ?? {}).sort();
  const key = processKey && keys.includes(processKey) ? processKey : keys[0];
  const revision = workspace?.model.revision;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sources = useMemo(() => (workspace ? processSources(workspace) : new Map<string, string>()), [workspace, revision]);
  const overlays = useMemo(() => overlaysForVisits(key ? visited?.byProcess?.[key] : undefined), [visited, key]);
  const decisions = response?.report.decisions ?? [];

  if (record.running) return <p className="muted pad" data-testid="scenario-running">{t('run.scenario.running')}</p>;
  if (record.error) {
    return (
      <section className="notice error" data-testid="scenario-error">
        {record.error}
        {record.problems && record.problems.length > 0 && (
          <ul className="run-list problems">
            {record.problems.map((p, i) => (
              <li key={i} className={p.severity}><span className="muted">[{p.source}]</span> {p.path ?? ''}{p.elementId ? ` (${p.elementId})` : ''}: {p.message}</li>
            ))}
          </ul>
        )}
      </section>
    );
  }
  if (!response) return null;
  const failed = scenarios.filter((s) => s.status === 'FAILED').length + decisions.filter((d) => d.status === 'FAILED').length;
  return (
    <div className="scenario-report" data-testid="scenario-report" data-passed={String(response.passed)}>
      <p className={`notice ${response.passed ? 'ok' : 'error'}`} data-testid="scenario-summary">
        <strong>{response.passed ? t('run.report.passed') : t('run.report.failed', { count: failed })}</strong> - {t(scenarios.length === 1 ? 'run.report.scenarios.one' : 'run.report.scenarios.other', { count: scenarios.length })}
        {decisions.length ? `, ${t(decisions.length === 1 ? 'run.report.decisions.one' : 'run.report.decisions.other', { count: decisions.length })}` : ''} {t('run.report.took', { ms: response.durationMillis })}{' '}
        <button type="button" className="link" onClick={() => setRaw(!raw)}>{raw ? t('run.report.hideText') : t('run.report.showText')}</button>
      </p>
      {raw && <pre className="error-detail" data-testid="scenario-rendered">{response.rendered}</pre>}
      <div className="scenario-report-body">
        <div className="scenario-cards">
          {scenarios.map((s) => (
            <ScenarioCard key={s.name} scenario={s} selected={s.name === selectedName} onSelect={() => setPicked(s.name)} />
          ))}
          {decisions.map((d) => (
            <article key={d.name} className={`scenario-card status-${(d.status ?? 'PASSED').toLowerCase()}`} data-testid={`decision-result-${d.name}`}>
              <strong>{d.name}</strong> <span className="state">{d.status}</span>
              {(d.failures ?? []).map((f, i) => (
                <div key={i} className="field-error small">{f}</div>
              ))}
            </article>
          ))}
        </div>
        {keys.length > 0 && (
          <div className="scenario-path" data-testid="scenario-path">
            <div className="run-toolbar">
              <span className="muted">{t('run.report.pathOf', { name: selectedName ?? '' })}</span>
              <select value={key} onChange={(e) => setProcessKey(e.target.value)} aria-label={t('run.report.process')} data-testid="scenario-path-process">
                {keys.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <span className="muted small">{t('run.report.visited', { elements: overlays.completed?.length ?? 0, flows: overlays.flows?.length ?? 0 })}</span>
            </div>
            <DiagramPane xml={key ? sources.get(key) : undefined} overlays={overlays} testId="scenario-diagram" />
          </div>
        )}
      </div>
    </div>
  );
}
