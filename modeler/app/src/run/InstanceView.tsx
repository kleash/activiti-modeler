import { overlaysForInstance, type DiagramStructure } from '@activiti-modeler/activiti-diagram-viewer';
import type { InstanceDetail, Task } from '@activiti-modeler/runtime-client';
import { useMemo, useState } from 'react';

import { t } from '../i18n';
import { useController } from '../state/context';
import { connection } from './connection';
import { DiagramPane } from './DiagramPane';
import { usePolled, useRecorder } from './hooks';
import { InstanceEvents, InstancePath, InstanceJobs, InstanceTasks, InstanceVariables } from './instancePanels';
import { stateClass } from './InstancesTab';
import { recorder, type RecordedStep } from './recorder';
import { errorMessage, runService } from './runService';

type Panel = 'tasks' | 'variables' | 'jobs' | 'events' | 'path';
const LIVE_MS = 1500;

/** What a recorded action adds to the scenario: the step, and the user (with the groups that made the person a candidate). */
export interface RecordedAction {
  steps: RecordedStep[];
  groups?: readonly string[];
}

/** What the panels of an instance need to act: the current detail, a way to run an action and refresh, the selected diagram element. */
export interface InstanceContext {
  detail: InstanceDetail;
  tasks: Task[];
  running: boolean;
  user: string | undefined;
  selectedElement: string | undefined;
  messageNames: string[];
  signalNames: string[];
  /** Runs an action; `record` is the scenario step to keep when a scenario is being recorded and the action worked. */
  act(label: string, action: () => Promise<unknown>, success?: string, record?: RecordedAction): Promise<boolean>;
  busy: boolean;
}

/** Names of the messages and signals a BPMN document declares, for the suggestions of the Events panel. */
export function declaredEvents(xml: string | undefined): { messages: string[]; signals: string[] } {
  if (!xml) return { messages: [], signals: [] };
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const names = (local: string): string[] =>
    [...new Set([...doc.getElementsByTagNameNS('*', local)].map((e) => e.getAttribute('name') ?? '').filter((n) => n !== ''))].sort();
  return { messages: names('message'), signals: names('signal') };
}

/**
 * One process instance (R4, R5): the diagram with the tokens, the path taken and the incidents; and the things to do with it: tasks,
 * variables, jobs, messages and signals. It refreshes itself while the instance is running.
 */
export function InstanceView({ id }: { id: string }) {
  const controller = useController();
  const detail = usePolled(() => connection.require().getProcessInstance(id), `detail:${id}`, LIVE_MS);
  const data = detail.data;
  const running = data?.state === 'ACTIVE' || data?.state === 'SUSPENDED';
  // a finished instance does not change: one more look is enough, so the interval stays but the data is the same
  const tasks = usePolled(() => connection.require().listTasks({ processInstanceId: id, candidates: true, size: 100 }), `tasks:${id}`, LIVE_MS, running || !data);
  const xml = usePolled(() => connection.require().getProcessDefinitionXml(data!.processDefinitionId), `xml:${data?.processDefinitionId ?? ''}`, 0, data !== undefined);
  const [panel, setPanel] = useState<Panel>('tasks');
  const [selected, setSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const recording = useRecorder();

  const overlays = useMemo(() => (structure: DiagramStructure) => (data ? overlaysForInstance(data, structure) : {}), [data]);
  const declared = useMemo(() => declaredEvents(xml.data), [xml.data]);

  const act = async (label: string, action: () => Promise<unknown>, success?: string, record?: RecordedAction): Promise<boolean> => {
    setBusy(true);
    try {
      await action();
      if (success) controller.toast(success, 'success');
      const actor = connection.getSnapshot().user;
      if (record && actor) for (const step of record.steps) recorder.note(id, step, { name: actor, groups: record.groups ?? [] });
      return true;
    } catch (e) {
      controller.toast(t('run.instance.actionFailed', { action: label }), 'error', errorMessage(e));
      return false;
    } finally {
      setBusy(false);
      await Promise.all([detail.reload(), tasks.reload()]);
    }
  };

  /** Names the scenario, writes `scenarios/<name>.scenario.json` into the project and opens it in the scenario editor. */
  const saveRecording = async (current: InstanceDetail): Promise<void> => {
    const workspace = controller.workspace;
    if (!workspace) return;
    const taken = new Set(workspace.model.paths());
    const fileOf = (name: string): string => `scenarios/${name.trim().replace(/[^A-Za-z0-9._-]+/g, '-')}.scenario.json`;
    const name = await controller.askText({
      title: t('run.recording.saveTitle'),
      label: t('run.recording.name'),
      initial: t('run.recording.defaultName', { process: current.processDefinitionKey }),
      confirmLabel: t('run.recording.save'),
      hint: t('run.recording.hint'),
      validate: (value) => (!value.trim() ? t('run.recording.nameMissing') : taken.has(fileOf(value)) ? t('run.recording.exists', { file: fileOf(value) }) : undefined),
    });
    if (name === undefined) return;
    try {
      const final = await connection.require().getProcessInstance(current.id);
      const path = fileOf(name);
      await workspace.createFile(path, `${JSON.stringify(recorder.build(name.trim(), final), null, 2)}\n`);
      recorder.discard();
      controller.toast(t('run.recording.saved', { file: path }), 'success');
      runService.closeWorkbench();
      void controller.openTab(path);
    } catch (e) {
      controller.toast(t('run.recording.notSaved'), 'error', errorMessage(e));
    }
  };

  if (detail.loading && !data) return <p className="muted pad">{t('run.instance.loading')}</p>;
  if (!data) return <p className="field-error pad">{detail.error ?? t('run.instance.unreadable')}</p>;
  const context: InstanceContext = {
    detail: data,
    tasks: tasks.data?.items ?? data.tasks,
    running,
    user: connection.getSnapshot().user,
    selectedElement: selected,
    messageNames: declared.messages,
    signalNames: declared.signals,
    act,
    busy,
  };
  const incidentCount = data.jobs.filter((j) => j.kind === 'DEADLETTER').length;
  const taskCount = context.tasks.length;
  const jobCount = data.jobs.length;

  return (
    <div className="instance-view" data-testid="instance-view" data-instance={data.id} data-state={data.state}>
      <header className="instance-header">
        <h2>
          {data.processDefinitionName ?? data.processDefinitionKey} <span className="muted small">{t('run.version', { version: data.processDefinitionVersion ?? '' })}</span>
        </h2>
        <span className={stateClass(data.state)} data-testid="instance-state">{data.state}</span>
        <span className="muted small" data-testid="instance-id">{data.id}</span>
        {data.businessKey && <span className="muted small">{t('run.instance.businessKey')} <strong>{data.businessKey}</strong></span>}
        {data.startUserId && <span className="muted small">{t('run.instance.startedBy', { user: data.startUserId })}</span>}
        {data.superProcessInstanceId && (
          <button type="button" className="btn small" onClick={() => runService.showInstance(data.superProcessInstanceId)}>
            {t('run.instance.parent')}
          </button>
        )}
        <span className="spacer" />
        {running && data.state === 'ACTIVE' && (
          <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.instance.suspend'), () => connection.require().suspendProcessInstance(id), t('run.instance.suspended'))} data-testid="instance-suspend">
            {t('run.instance.suspend')}
          </button>
        )}
        {running && data.state === 'SUSPENDED' && (
          <button type="button" className="btn small" disabled={busy} onClick={() => void act(t('run.instance.activate'), () => connection.require().activateProcessInstance(id), t('run.instance.activated'))} data-testid="instance-activate">
            {t('run.instance.activate')}
          </button>
        )}
        {running && (
          <button
            type="button"
            className="btn small danger"
            disabled={busy}
            onClick={() =>
              void (async () => {
                const answer = await controller.askChoice({ title: t('run.instance.cancelTitle'), message: t('run.instance.cancelMessage', { id: data.id.slice(0, 8), process: data.processDefinitionKey }), choices: [{ id: 'cancel', label: t('run.instance.cancelConfirm'), danger: true }, { id: 'keep', label: t('run.instance.keep'), primary: true }] });
                if (answer === 'cancel') await act(t('run.instance.cancelAction'), () => connection.require().deleteProcessInstance(id, { reason: 'cancelled in the modeler' }), t('run.instance.cancelled'));
              })()
            }
            data-testid="instance-cancel"
          >
            {t('run.instance.cancel')}
          </button>
        )}
      </header>
      {recording.recording && recording.instanceId === data.id && (
        <div className="notice recording" data-testid="recording-banner">
          <strong>{t('run.recording.title')}</strong> {t(recording.steps === 1 ? 'run.recording.steps.one' : 'run.recording.steps.other', { subject: recording.subject ?? '', count: recording.steps })}{' '}
          <button type="button" className="btn small primary" onClick={() => void saveRecording(data)} data-testid="recording-save">{t('run.recording.saveAs')}</button>{' '}
          <button type="button" className="btn small" onClick={() => recorder.discard()} data-testid="recording-discard">{t('run.recording.discard')}</button>
        </div>
      )}
      {incidentCount > 0 && (
        <p className="notice error" data-testid="instance-incident">
          {t(incidentCount === 1 ? 'run.instance.incidents.one' : 'run.instance.incidents.other', { count: incidentCount })}
        </p>
      )}
      <div className="instance-body">
        <div className="instance-diagram">
          <DiagramPane xml={xml.data} overlays={overlays} selected={selected} onSelect={setSelected} testId="instance-diagram" />
          <ul className="legend" aria-label={t('run.legend.label')}>
            <li><span className="swatch active" /> {t('run.legend.active')}</li>
            <li><span className="swatch completed" /> {t('run.legend.completed')}</li>
            <li><span className="swatch incident" /> {t('run.legend.incident')}</li>
            <li><span className="swatch flow" /> {t('run.legend.flow')}{data.path.sequenceFlowsSource === 'inferred' ? t('run.legend.inferred') : ''}</li>
          </ul>
          {data.path.sequenceFlowsSource === 'inferred' && (
            <p className="muted small pad" data-testid="flows-inferred">
              {t('run.instance.flowsInferred')}
            </p>
          )}
        </div>
        <div className="instance-side">
          <nav role="tablist" className="panel-tabs" aria-label={t('run.instance.panels')}>
            {(
              [
                ['tasks', `${t('run.panel.tasks')}${taskCount ? ` (${taskCount})` : ''}`],
                ['variables', `${t('run.panel.variables')} (${data.variables.length})`],
                ['jobs', `${t('run.panel.jobs')}${jobCount ? ` (${jobCount})` : ''}`],
                ['events', t('run.panel.events')],
                ['path', t('run.panel.path')],
              ] as Array<[Panel, string]>
            ).map(([id2, label]) => (
              <button key={id2} type="button" role="tab" aria-selected={panel === id2} className={panel === id2 ? 'selected' : ''} onClick={() => setPanel(id2)} data-testid={`instance-panel-${id2}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="panel-content" role="tabpanel">
            {selected && (
              <p className="muted small selection">
                {t('run.instance.selected')} <strong>{selected}</strong>{' '}
                <button type="button" className="link" onClick={() => setSelected(undefined)}>{t('run.instance.clear')}</button>
              </p>
            )}
            {panel === 'tasks' && <InstanceTasks ctx={context} />}
            {panel === 'variables' && <InstanceVariables ctx={context} />}
            {panel === 'jobs' && <InstanceJobs ctx={context} />}
            {panel === 'events' && <InstanceEvents ctx={context} />}
            {panel === 'path' && <InstancePath ctx={context} />}
          </div>
          {data.children.length > 0 && (
            <section className="children" data-testid="instance-children">
              <h4>{t('run.instance.children')}</h4>
              <ul className="run-list">
                {data.children.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="link" onClick={() => runService.showInstance(c.id)} data-testid={`child-${c.id}`}>
                      {c.processDefinitionKey} {c.id.slice(0, 8)}
                    </button>{' '}
                    <span className={stateClass(c.state)}>{c.state}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
