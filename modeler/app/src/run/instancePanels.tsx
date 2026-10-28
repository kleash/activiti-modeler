import type { Job } from '@activiti-modeler/runtime-client';
import { useState } from 'react';

import { t } from '../i18n';
import { connection } from './connection';
import type { InstanceContext } from './InstanceView';
import { VariablesEditor } from './VariablesEditor';
import { convert, rowsToVariables, textOf, typeOf, type VariableRow } from './variables';

const time = (value: string | undefined): string => (value ? new Date(value).toLocaleString() : '');

// ---- tasks ------------------------------------------------------------------------------------------------------------------------

/** Tasks (R5): claim, release, assign and complete with variables, as the signed-in user. */
export function InstanceTasks({ ctx }: { ctx: InstanceContext }) {
  const { tasks, user } = ctx;
  if (tasks.length === 0) return <p className="muted pad" data-testid="no-tasks">{t(ctx.running ? 'run.tasks.none' : 'run.tasks.noneEnded')}</p>;
  return (
    <div className="task-cards" data-testid="task-list">
      <p className="muted small">{t('run.tasks.actingAs')} <strong data-testid="acting-user">{user ?? '?'}</strong>. {t('run.tasks.howTo')}</p>
      {tasks.map((task) => (
        <TaskCard key={task.id} ctx={ctx} task={task} />
      ))}
    </div>
  );
}

function TaskCard({ ctx, task }: { ctx: InstanceContext; task: InstanceContext['tasks'][number] }) {
  const { user, act, busy } = ctx;
  const [completing, setCompleting] = useState(false);
  const [rows, setRows] = useState<VariableRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);
  const activity = task.taskDefinitionKey;
  const mine = task.assignee !== undefined && task.assignee === user;
  const selected = ctx.selectedElement !== undefined && ctx.selectedElement === task.taskDefinitionKey;
  const candidates = [...(task.candidateUsers ?? []).map((u) => t('run.tasks.candidateUser', { name: u })), ...(task.candidateGroups ?? []).map((g) => t('run.tasks.candidateGroup', { name: g }))];

  const complete = async (): Promise<void> => {
    const { variables, errors: found } = rowsToVariables(rows);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const ok = await act(
      t('run.tasks.completeAction'),
      async () => {
        const client = connection.require();
        // like the scenario runner: a task nobody holds is claimed first
        if (!task.assignee) await client.claimTask(task.id);
        await client.completeTask(task.id, Object.keys(variables).length > 0 ? variables : undefined);
      },
      t('run.tasks.completed', { task: task.name ?? task.taskDefinitionKey ?? t('run.tasks.theTask') }),
      activity && user
        ? {
            groups: task.candidateGroups ?? [],
            steps: [
              { expectTask: { activity } },
              ...(task.assignee ? [] : [{ claim: { activity, user } }]),
              { completeTask: { activity, user, ...(Object.keys(variables).length > 0 ? { variables } : {}) } },
            ],
          }
        : undefined,
    );
    if (ok) setCompleting(false);
  };

  return (
    <article className={`task-card${selected ? ' selected' : ''}`} data-testid={`task-${task.taskDefinitionKey ?? task.id}`} data-task-id={task.id} data-assignee={task.assignee ?? ''}>
      <header>
        <strong>{task.name ?? task.taskDefinitionKey}</strong> <span className="muted small">{task.taskDefinitionKey}</span>
      </header>
      <dl className="facts">
        <dt>{t('run.tasks.assignee')}</dt>
        <dd data-testid="task-assignee">{task.assignee ?? <em>{t('run.tasks.unassigned')}</em>}</dd>
        {task.owner && (<><dt>{t('run.tasks.owner')}</dt><dd>{task.owner}</dd></>)}
        {candidates.length > 0 && (<><dt>{t('run.tasks.candidates')}</dt><dd data-testid="task-candidates">{candidates.join(', ')}</dd></>)}
        {task.dueDate && (<><dt>{t('run.tasks.due')}</dt><dd>{time(task.dueDate)}</dd></>)}
        <dt>{t('run.tasks.priority')}</dt><dd>{task.priority}</dd>
        {task.formKey && (<><dt>{t('run.tasks.form')}</dt><dd><code>{task.formKey}</code></dd></>)}
      </dl>
      <div className="button-row">
        {!task.assignee && (
          <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.tasks.claim'), () => connection.require().claimTask(task.id), t('run.tasks.claimed', { user: user ?? '' }), activity && user ? { groups: task.candidateGroups ?? [], steps: [{ claim: { activity, user } }] } : undefined)} data-testid="task-claim">
            {t('run.tasks.claim')}
          </button>
        )}
        {mine && (
          <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.tasks.release'), () => connection.require().releaseTask(task.id), t('run.tasks.released'), activity && user ? { steps: [{ release: { activity, user } }] } : undefined)} data-testid="task-release">
            {t('run.tasks.release')}
          </button>
        )}
        <button type="button" className="btn small" disabled={busy} onClick={() => setAssigning(!assigning)} data-testid="task-assign">
          {t('run.tasks.assign')}
        </button>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => setCompleting(!completing)} data-testid="task-complete">
          {t('run.tasks.complete')}
        </button>
      </div>
      {assigning && (
        <div className="inline-form">
          <input value={assignTo} onChange={(e) => setAssignTo(e.target.value)} placeholder={t('run.tasks.assignPlaceholder')} aria-label={t('run.tasks.assignTo')} spellCheck={false} data-testid="task-assign-to" />
          <button
            type="button"
            className="btn small"
            disabled={busy || assignTo.trim() === ''}
            onClick={() => void act(t('run.tasks.assignConfirm'), () => connection.require().assignTask(task.id, assignTo.trim()), t('run.tasks.assigned', { user: assignTo.trim() }), activity && (task.assignee ?? user) ? { steps: [{ assign: { activity, assignee: assignTo.trim(), user: (task.assignee ?? user)! } }] } : undefined).then((ok) => ok && setAssigning(false))}
            data-testid="task-assign-confirm"
          >
            {t('run.tasks.assignConfirm')}
          </button>
        </div>
      )}
      {completing && (
        <div className="inline-form column">
          <p className="muted small">{t('run.tasks.completionHelp')}{!task.assignee ? t('run.tasks.claimFirst') : ''}</p>
          <VariablesEditor rows={rows} onChange={setRows} errors={errors} testId="complete-variables" />
          <button type="button" className="btn small primary" disabled={busy} onClick={() => void complete()} data-testid="task-complete-confirm">
            {t('run.tasks.completeTask')}
          </button>
        </div>
      )}
    </article>
  );
}

// ---- variables --------------------------------------------------------------------------------------------------------------------

/** Variables (R4): the values, editable while the instance runs. */
export function InstanceVariables({ ctx }: { ctx: InstanceContext }) {
  const { detail, running, act, busy } = ctx;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<VariableRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const client = () => connection.require();

  const save = async (name: string, current: unknown): Promise<void> => {
    const converted = convert(typeOf(current), drafts[name] ?? textOf(current));
    if (!converted.ok) {
      setErrors({ ...errors, [name]: converted.error });
      return;
    }
    setErrors((e) => ({ ...e, [name]: '' }));
    const ok = await act(t('run.variables.set', { name }), () => client().setProcessInstanceVariables(detail.id, { [name]: converted.value }), t('run.variables.saved', { name }), { steps: [{ setVariables: { [name]: converted.value } }] });
    if (ok) {
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[name];
        return rest;
      });
    }
  };

  const addAll = async (): Promise<void> => {
    const { variables, errors: found } = rowsToVariables(adding);
    setErrors(found);
    if (Object.keys(found).length > 0 || Object.keys(variables).length === 0) return;
    const ok = await act(t('run.variables.setAll'), () => client().setProcessInstanceVariables(detail.id, variables), t('run.variables.allSaved'), { steps: [{ setVariables: variables }] });
    if (ok) setAdding([]);
  };

  return (
    <div data-testid="variables-panel">
      {detail.variables.length === 0 && <p className="muted pad">{t('run.variables.none')}</p>}
      {detail.variables.length > 0 && (
        <table className="run-table variables">
          <thead>
            <tr>
              <th>{t('run.variables.name')}</th>
              <th>{t('run.variables.type')}</th>
              <th>{t('run.variables.value')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {detail.variables.map((v) => {
              const draft = drafts[v.name];
              const changed = draft !== undefined && draft !== textOf(v.value);
              return (
                <tr key={v.name} data-testid={`variable-${v.name}`}>
                  <td><strong>{v.name}</strong></td>
                  <td className="muted small">{v.type ?? typeOf(v.value)}</td>
                  <td>
                    {running ? (
                      <>
                        <input value={draft ?? textOf(v.value)} onChange={(e) => setDrafts({ ...drafts, [v.name]: e.target.value })} aria-label={t('run.variables.valueOf', { name: v.name })} spellCheck={false} data-testid={`variable-value-${v.name}`} />
                        {errors[v.name] && <div className="field-error small">{errors[v.name]}</div>}
                      </>
                    ) : (
                      <code data-testid={`variable-value-${v.name}`}>{textOf(v.value)}</code>
                    )}
                  </td>
                  <td className="nowrap">
                    {running && (
                      <>
                        <button type="button" className="btn small" disabled={!changed || busy} onClick={() => void save(v.name, v.value)} data-testid={`variable-save-${v.name}`}>{t('run.variables.save')}</button>{' '}
                        <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.variables.remove', { name: v.name }), () => client().removeProcessInstanceVariables(detail.id, [v.name]), t('run.variables.removed', { name: v.name }))} aria-label={t('run.variables.remove', { name: v.name })}>x</button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {running && (
        <div className="inline-form column">
          <h4>{t('run.variables.addTitle')}</h4>
          <VariablesEditor rows={adding} onChange={setAdding} errors={errors} testId="add-variables" />
          {adding.length > 0 && (
            <button type="button" className="btn small primary" disabled={busy} onClick={() => void addAll()} data-testid="variables-save-new">
              {t('run.variables.saveNew')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- jobs -------------------------------------------------------------------------------------------------------------------------

/** Jobs (R5): fire timers, execute jobs, retry dead letters, look at the stack trace of a failure. */
export function InstanceJobs({ ctx }: { ctx: InstanceContext }) {
  const { detail, act, busy } = ctx;
  const [trace, setTrace] = useState<string | undefined>();
  const jobs = detail.jobs;
  if (jobs.length === 0) return <p className="muted pad" data-testid="no-jobs">{t('run.jobs.none')}</p>;
  const client = () => connection.require();
  return (
    <div data-testid="jobs-panel">
      <table className="run-table">
        <thead>
          <tr>
            <th>{t('run.jobs.kind')}</th>
            <th>{t('run.jobs.activity')}</th>
            <th>{t('run.jobs.due')}</th>
            <th>{t('run.jobs.retries')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} data-testid={`job-${job.activityId ?? job.id}`} data-kind={job.kind} className={job.kind === 'DEADLETTER' ? 'dead' : ''}>
              <td><span className={`kind kind-${job.kind.toLowerCase()}`}>{job.kind}</span></td>
              <td>
                {job.activityId ?? ''}
                {job.exceptionMessage && <div className="field-error small" data-testid="job-exception">{job.exceptionMessage}</div>}
              </td>
              <td className="small">{time(job.dueDate)}</td>
              <td>{job.retries}</td>
              <td className="nowrap">
                {job.kind === 'TIMER' && (
                  <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.jobs.fireAction'), () => client().fireTimer(job.id), t('run.jobs.fired', { activity: job.activityId ?? '' }), job.activityId ? { steps: [{ fireTimer: { activity: job.activityId } }] } : undefined)} data-testid="job-fire">{t('run.jobs.fire')}</button>
                )}
                {job.kind === 'JOB' && (
                  <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.jobs.executeAction'), () => client().executeJob(job.id), t('run.jobs.executed'), { steps: [{ executeJobs: {} }] })} data-testid="job-execute">{t('run.jobs.execute')}</button>
                )}
                {job.kind === 'DEADLETTER' && (
                  <>
                    <button type="button" className="btn small primary" disabled={busy} onClick={() => void act(t('run.jobs.retryAction'), () => client().retryDeadLetterJob(job.id, { retries: 3, execute: true }), t('run.jobs.retried'))} data-testid="job-retry">{t('run.jobs.retry')}</button>{' '}
                    <button type="button" className="btn small" disabled={busy} onClick={() => void showTrace(job, setTrace)} data-testid="job-trace">{t('run.jobs.trace')}</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {trace && <pre className="error-detail" data-testid="job-stacktrace">{trace}</pre>}
    </div>
  );
}

async function showTrace(job: Job, set: (text: string | undefined) => void): Promise<void> {
  try {
    set((await connection.require().getJob(job.id)).stacktrace ?? job.exceptionMessage ?? t('run.jobs.noTrace'));
  } catch (e) {
    set(e instanceof Error ? e.message : String(e));
  }
}

// ---- events -----------------------------------------------------------------------------------------------------------------------

/** Messages, signals and receive tasks (R5). */
export function InstanceEvents({ ctx }: { ctx: InstanceContext }) {
  const { detail, running, act, busy } = ctx;
  const [messageName, setMessageName] = useState('');
  const [correlation, setCorrelation] = useState('');
  const [messageRows, setMessageRows] = useState<VariableRow[]>([]);
  const [signalName, setSignalName] = useState('');
  const [signalRows, setSignalRows] = useState<VariableRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const waiting = detail.executions.filter((e) => e.activityType === 'receiveTask');
  const client = () => connection.require();

  const send = async (kind: 'message' | 'signal'): Promise<void> => {
    const rows = kind === 'message' ? messageRows : signalRows;
    const { variables, errors: found } = rowsToVariables(rows);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const payload = Object.keys(variables).length > 0 ? { variables } : {};
    if (kind === 'message') {
      await act(t('run.events.messageAction'), () => client().sendMessage({ name: messageName.trim(), ...(correlation.trim() ? { correlationKey: correlation.trim() } : {}), ...payload }), t('run.events.messageSent', { name: messageName.trim() }), {
        steps: [{ message: { name: messageName.trim(), ...(correlation.trim() ? { correlationKey: correlation.trim() } : {}), ...payload } }],
      });
    } else {
      await act(t('run.events.signalAction'), () => client().sendSignal({ name: signalName.trim(), ...payload }), t('run.events.signalSent', { name: signalName.trim() }), { steps: [{ signal: { name: signalName.trim(), ...payload } }] });
    }
  };

  return (
    <div data-testid="events-panel">
      {!running && <p className="muted pad">{t('run.events.ended')}</p>}
      <section className="inline-form column">
        <h4>{t('run.events.message')}</h4>
        <p className="muted small">{t('run.events.messageHelp')}</p>
        <input list="run-message-names" value={messageName} onChange={(e) => setMessageName(e.target.value)} placeholder={t('run.events.messagePlaceholder')} aria-label={t('run.events.messageName')} spellCheck={false} data-testid="message-name" />
        <datalist id="run-message-names">{ctx.messageNames.map((n) => <option key={n} value={n} />)}</datalist>
        <input value={correlation} onChange={(e) => setCorrelation(e.target.value)} placeholder={t('run.events.correlationPlaceholder')} aria-label={t('run.events.correlation')} spellCheck={false} data-testid="message-correlation" />
        <VariablesEditor rows={messageRows} onChange={setMessageRows} errors={errors} testId="message-variables" />
        <button type="button" className="btn small primary" disabled={busy || messageName.trim() === ''} onClick={() => void send('message')} data-testid="message-send">{t('run.events.sendMessage')}</button>
      </section>
      <section className="inline-form column">
        <h4>{t('run.events.signal')}</h4>
        <p className="muted small">{t('run.events.signalHelp')}</p>
        <input list="run-signal-names" value={signalName} onChange={(e) => setSignalName(e.target.value)} placeholder={t('run.events.signalPlaceholder')} aria-label={t('run.events.signalName')} spellCheck={false} data-testid="signal-name" />
        <datalist id="run-signal-names">{ctx.signalNames.map((n) => <option key={n} value={n} />)}</datalist>
        <VariablesEditor rows={signalRows} onChange={setSignalRows} errors={errors} testId="signal-variables" />
        <button type="button" className="btn small primary" disabled={busy || signalName.trim() === ''} onClick={() => void send('signal')} data-testid="signal-send">{t('run.events.sendSignal')}</button>
      </section>
      <section className="inline-form column">
        <h4>{t('run.events.receiveTasks')}</h4>
        {waiting.length === 0 && <p className="muted small" data-testid="no-receive-tasks">{t('run.events.noReceiveTasks')}</p>}
        {waiting.map((execution) => (
          <div key={execution.id} className="inline-form">
            <span>{execution.activityName ?? execution.activityId} <span className="muted small">{execution.activityId}</span></span>
            <button type="button" className="btn small primary" disabled={busy} onClick={() => void act(t('run.events.trigger'), () => client().triggerExecution(execution.id), t('run.events.triggered', { activity: execution.activityId }), { steps: [{ triggerReceiveTask: { activity: execution.activityId } }] })} data-testid={`trigger-${execution.activityId}`}>
              {t('run.events.trigger')}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

// ---- path -------------------------------------------------------------------------------------------------------------------------

/** The path taken: activities in order and the sequence flows. */
export function InstancePath({ ctx }: { ctx: InstanceContext }) {
  const { path } = ctx.detail;
  return (
    <div data-testid="path-panel">
      <table className="run-table">
        <thead>
          <tr>
            <th>{t('run.path.activity')}</th>
            <th>{t('run.path.type')}</th>
            <th>{t('run.path.start')}</th>
            <th>{t('run.path.ms')}</th>
          </tr>
        </thead>
        <tbody>
          {path.activities.map((a, i) => (
            <tr key={`${a.activityId}-${i}`} data-testid={`path-activity-${a.activityId}`} className={a.endTime ? '' : 'open'}>
              <td>
                <strong>{a.activityId}</strong> {a.activityName ? <span className="muted small">{a.activityName}</span> : null}
                {a.assignee ? <span className="muted small"> ({a.assignee})</span> : null}
              </td>
              <td className="small">{a.activityType}</td>
              <td className="small">{time(a.startTime)}</td>
              <td className="small">{a.durationMillis ?? (a.endTime ? '' : t('run.path.running'))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>{t('run.path.flows', { source: path.sequenceFlowsSource })}</h4>
      <p className="small" data-testid="path-flows">{path.sequenceFlows.length === 0 ? t('run.path.none') : path.sequenceFlows.map((f) => f.id).join(', ')}</p>
    </div>
  );
}
