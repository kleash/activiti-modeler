import { useState } from 'react';

import { t } from '../i18n';
import { lintService } from '../lint/LintService';
import { useController } from '../state/context';
import { connection } from './connection';
import { DmnPreview } from './DmnPreview';
import { useConnection, usePolled, useRun } from './hooks';
import { runService } from './runService';

/** Deploy (R2): the button, what the engine made of the project, and the problems that stopped it. */
export function DeployTab() {
  const run = useRun();
  const controller = useController();
  const conn = useConnection();
  const [decision, setDecision] = useState<{ resource: string; id: string; matched?: string[] } | undefined>();
  const defs = usePolled(() => connection.require().listProcessDefinitions({ latest: true, size: 200, includeCounts: true }), `defs:${run.deployment?.deploymentId ?? ''}:${conn.status}`, 4000);
  const d = run.deployment;
  const outcome = run.lastOutcome;
  return (
    <div className="run-pane" data-testid="deploy-tab">
      <div className="run-toolbar">
        <button type="button" className="btn primary" disabled={run.deploying || !controller.workspace} onClick={() => void runService.deploy()} data-testid="deploy-button">
          {run.deploying ? t('run.deploy.deploying') : t('run.deploy.deploy')}
        </button>
        <span className="muted">
          {t('run.deploy.hint', { project: controller.workspace ? `"${controller.workspace.name}"` : t('run.deploy.theProject') })}
        </span>
      </div>

      {outcome && <Outcome outcome={outcome} />}

      {d && (
        <section className="run-section" data-testid="deploy-result">
          <h3>{t('run.deploy.last')}</h3>
          <p data-testid="deploy-summary">
            <strong>{d.name ?? d.deploymentId}</strong> - {t('run.deploy.deployment')} <code>{d.deploymentId}</code> {t('run.deploy.ofProject', { project: d.project, time: new Date(d.at).toLocaleTimeString() })}
          </p>
          <table className="run-table" data-testid="deploy-definitions">
            <thead>
              <tr>
                <th>{t('run.deploy.definition')}</th>
                <th>{t('run.deploy.version')}</th>
                <th>{t('run.deploy.resource')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.definitions.map((def) => (
                <tr key={def.id}>
                  <td>
                    <strong>{def.key}</strong> {def.name ? <span className="muted">{def.name}</span> : null}
                  </td>
                  <td>{def.version}</td>
                  <td>
                    <code>{def.resourceName}</code>
                  </td>
                  <td>
                    <button type="button" className="btn small" onClick={() => runService.startForm(def.key)} data-testid={`deploy-start-${def.key}`}>
                      {t('run.deploy.start')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.decisions.some((r) => r.decisions.length > 0 || r.error) && (
            <>
              <h4>{t('run.deploy.decisions')}</h4>
              <table className="run-table" data-testid="deploy-decisions">
                <thead>
                  <tr>
                    <th>{t('run.deploy.decision')}</th>
                    <th>{t('run.deploy.kind')}</th>
                    <th>{t('run.deploy.hitPolicy')}</th>
                    <th>{t('run.deploy.resource')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.decisions.flatMap((r) => [
                    ...r.decisions.map((dec) => (
                      <tr key={`${r.resourceName}:${dec.id}`}>
                        <td>
                          <strong>{dec.id}</strong> {dec.name ? <span className="muted">{dec.name}</span> : null}
                        </td>
                        <td>{dec.kind}</td>
                        <td>{dec.hitPolicy ?? ''}{dec.aggregation ? ` (${dec.aggregation})` : ''}</td>
                        <td>
                          <code>{r.resourceName}</code>
                        </td>
                        <td>
                          <button type="button" className="btn small" onClick={() => setDecision({ resource: r.resourceName, id: dec.id })} data-testid={`deploy-view-${dec.id}`}>
                            {t('run.deploy.view')}
                          </button>
                        </td>
                      </tr>
                    )),
                    ...(r.error ? [<tr key={`${r.resourceName}:error`}><td colSpan={5} className="field-error">{r.resourceName}: {r.error}</td></tr>] : []),
                  ])}
                </tbody>
              </table>
            </>
          )}
          <h4>{t('run.deploy.resources')}</h4>
          <ul className="run-list" data-testid="deploy-resources">
            {d.resources.map((r) => (
              <li key={r}>
                <code>{r}</code>
              </li>
            ))}
          </ul>
          {d.problems.length > 0 && (
            <>
              <h4>{t('run.deploy.notes')}</h4>
              <ProblemList problems={d.problems} />
            </>
          )}
        </section>
      )}

      <section className="run-section">
        <h3>{t('run.deploy.onServer')}</h3>
        {defs.error && <p className="field-error">{defs.error}</p>}
        {defs.data && defs.data.items.length === 0 && <p className="muted">{t('run.deploy.nothing')}</p>}
        {defs.data && defs.data.items.length > 0 && (
          <table className="run-table" data-testid="server-definitions">
            <thead>
              <tr>
                <th>{t('run.deploy.key')}</th>
                <th>{t('run.deploy.name')}</th>
                <th>{t('run.deploy.version')}</th>
                <th>{t('run.deploy.running')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {defs.data.items.map((p) => (
                <tr key={p.id} data-testid={`server-definition-${p.key}`}>
                  <td><strong>{p.key}</strong></td>
                  <td>{p.name ?? ''}</td>
                  <td>{p.version}{p.suspended ? t('run.deploy.suspended') : ''}</td>
                  <td>{p.runningInstances ?? ''}</td>
                  <td>
                    <button type="button" className="btn small" onClick={() => runService.startForm(p.key)}>{t('run.deploy.start')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {decision && <DmnPreview deploymentId={d?.deploymentId} resource={decision.resource} decisionId={decision.id} onClose={() => setDecision(undefined)} />}
    </div>
  );
}

function Outcome({ outcome }: { outcome: NonNullable<ReturnType<typeof useRun>['lastOutcome']> }) {
  const controller = useController();
  if (outcome.kind === 'cancelled') {
    const text = { warnings: t('run.deploy.cancelled.warnings'), save: t('run.deploy.cancelled.save'), 'not-connected': t('run.deploy.cancelled.notConnected'), empty: t('run.deploy.cancelled.empty') }[outcome.reason];
    return <p className="notice" data-testid="deploy-outcome">{text}</p>;
  }
  if (outcome.kind === 'failed') return <p className="notice error" data-testid="deploy-outcome">{t('run.deploy.failed', { message: outcome.message })}</p>;
  if (outcome.kind === 'refused') {
    return (
      <section className="notice error" data-testid="deploy-outcome">
        <strong>{t('run.deploy.refused')}</strong> {outcome.message}
        <ProblemList problems={outcome.problems} />
      </section>
    );
  }
  return (
    <section className="notice error" data-testid="deploy-outcome">
      <strong>{t(outcome.counts.error === 1 ? 'run.deploy.errors.one' : 'run.deploy.errors.other', { count: outcome.counts.error })}</strong> {t('run.deploy.fixErrors')}
      <ul className="run-list problems" data-testid="deploy-problems">
        {outcome.problems.slice(0, 50).map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="link"
              onClick={() => {
                runService.closeWorkbench();
                void lintService.open(p);
                controller.focusActive();
              }}
            >
              {p.path}
              {p.elementId ? ` (${p.elementId})` : ''}
            </button>{' '}
            <span className="muted">[{p.source ?? 'lint'}]</span> {p.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProblemList({ problems }: { problems: Array<{ path?: string | undefined; elementId?: string | undefined; severity: string; message: string; source: string }> }) {
  return (
    <ul className="run-list problems">
      {problems.map((p, i) => (
        <li key={i} className={p.severity}>
          <span className="muted">[{p.source}]</span> {p.path ?? ''}
          {p.elementId ? ` (${p.elementId})` : ''}: {p.message}
        </li>
      ))}
    </ul>
  );
}
