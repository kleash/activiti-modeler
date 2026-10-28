import type { ModelerApi } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C05 timers, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`;
 * the runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this
 * folder against it.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C05';
const INCREMENT = 'io.github.kleash.activiti.harness.support.IncrementDelegate';

async function newProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string): Promise<void> {
  await api.newProcess(id, name, { file });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

type Timer = { type: 'date' | 'duration' | 'cycle'; value: string; endDate?: string };

/** user task with a non-interrupting boundary timer whose reminder branch counts the firings; the task ends the process otherwise. */
async function reminderProcess(api: ModelerApi, file: string, id: string, name: string, documentation: string, task: { id: string; name: string }, timer: { id: string; timer: Timer }): Promise<void> {
  await newProcess(api, file, id, name, documentation);
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: task.id, name: task.name, at: at(1, 1) });
  await api.setProperty(task.id, 'user.assignee', 'ann');
  await api.createShape({ type: 'boundaryEvent', id: timer.id, name: 'Reminder', eventDefinition: 'timer', interrupting: false, attachedTo: task.id });
  await api.setProperty(timer.id, 'timer.definition', timer.timer);
  await api.createShape({ type: 'serviceTask', id: 'remind', name: 'Count the reminder', at: at(2, 2) });
  await api.setProperty('remind', 'impl.type', 'class');
  await api.setProperty('remind', 'impl.class', INCREMENT);
  await api.setProperty('remind', 'fields.list', [{ name: 'variable', string: 'reminders' }]);
  await api.createShape({ type: 'endEvent', id: 'remindedEnd', name: 'Reminded', at: at(3, 2) });
  await api.createShape({ type: 'endEvent', id: 'doneEnd', name: 'Done', at: at(2, 0) });
  await chain(api, 'start', task.id);
  await chain(api, timer.id, 'remind', 'remindedEnd');
  await api.connect(task.id, 'doneEnd', `f_${task.id}_doneEnd`);
}

export default async function build(api: ModelerApi): Promise<void> {
  await api.createProject('C05-timers', { defaultMappings: 'none' });

  await reminderProcess(api, 'cron-timer', 'cronTimer', 'Non-interrupting cron timer',
    'A user task with a non-interrupting boundary timer (timeCycle 0 0/30 * * * ?): every firing runs the reminder branch, the task stays open.',
    { id: 'watch', name: 'Watch' }, { id: 'watchTimer', timer: { type: 'cycle', value: '0 0/30 * * * ?' } });

  await reminderProcess(api, 'end-date-timer', 'endDateTimer', 'Non-interrupting repeat with an end date',
    'A user task with a non-interrupting boundary timer (timeCycle R/PT1H): every firing runs the reminder branch, the task stays open.',
    { id: 'review', name: 'Review' }, { id: 'reviewTimer', timer: { type: 'cycle', value: 'R/PT1H', endDate: '2030-01-01T11:30:00Z' } });

  await reminderProcess(api, 'repeating-timer', 'repeatingTimer', 'Non-interrupting repeat (R3)',
    'A user task with a non-interrupting boundary timer (timeCycle R3/PT1H): every firing runs the reminder branch, the task stays open.',
    { id: 'draft', name: 'Draft' }, { id: 'draftTimer', timer: { type: 'cycle', value: 'R3/PT1H' } });

  // --- intermediate-timers ------------------------------------------------------------------------------------------------
  await newProcess(api, 'intermediate-timers', 'intermediateTimers', 'Intermediate timer catch events',
    'Three intermediate catch timers in a row: a duration, a fixed date and a cycle (which fires only once at an intermediate event).');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  const waits: Array<[string, string, Timer, string?]> = [
    ['waitDuration', '30 minutes pass', { type: 'duration', value: 'PT30M' }, 'duration'],
    ['waitDate', 'Noon arrives', { type: 'date', value: '2030-01-01T12:00:00Z' }],
    ['waitCycle', 'One hour, once', { type: 'cycle', value: 'R3/PT1H' }],
  ];
  for (const [i, [id, name, timer, calendar]] of waits.entries()) {
    await api.createShape({ type: 'intermediateCatchEvent', id, name, eventDefinition: 'timer', at: at(i + 1, 1) });
    await api.setProperty(id, 'timer.definition', timer);
    if (calendar) await api.setProperty(id, 'timer.businessCalendarName', calendar);
  }
  await api.createShape({ type: 'endEvent', id: 'end', at: at(4, 1) });
  await chain(api, 'start', 'waitDuration', 'waitDate', 'waitCycle', 'end');

  // --- interrupting-timers ------------------------------------------------------------------------------------------------
  await newProcess(api, 'interrupting-timers', 'interruptingTimers', 'Interrupting boundary timers',
    'Three user tasks in a row, each with an interrupting boundary timer of another kind: duration, fixed date, and a cycle (an interrupting timer never repeats).');
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  const tasks: Array<[string, string, string, string, string, Timer, string]> = [
    ['review', 'Review', 'reviewTimeout', '2 hours', 'reviewTimedOutEnd', { type: 'duration', value: 'PT2H' }, 'Review timed out'],
    ['approve', 'Approve', 'approveDeadline', 'Until 17:00', 'approveTimedOutEnd', { type: 'date', value: '2030-01-01T17:00:00Z' }, 'Approval timed out'],
    ['publish', 'Publish', 'publishCycle', 'Every hour', 'publishTimedOutEnd', { type: 'cycle', value: 'R3/PT1H' }, 'Publishing timed out'],
  ];
  for (const [i, [id, name, timerId, timerName, endId, timer, endName]] of tasks.entries()) {
    await api.createShape({ type: 'userTask', id, name, at: at(i * 2 + 1, 1) });
    await api.setProperty(id, 'user.assignee', 'ann');
    await api.createShape({ type: 'boundaryEvent', id: timerId, name: timerName, eventDefinition: 'timer', attachedTo: id });
    await api.setProperty(timerId, 'timer.definition', timer);
    await api.createShape({ type: 'endEvent', id: endId, name: endName, at: at(i * 2 + 1, 3) });
    await api.connect(timerId, endId, `f_${timerId}_${endId}`);
  }
  await api.createShape({ type: 'endEvent', id: 'doneEnd', name: 'Done', at: at(7, 1) });
  await chain(api, 'start', 'review', 'approve', 'publish', 'doneEnd');

  // --- timer-starts -------------------------------------------------------------------------------------------------------
  await newProcess(api, 'timer-starts', 'timerStarts', 'Timer start events',
    'One start event per timer kind: a fixed date, an ISO repeat with an end date, a cron expression with a business calendar, and a repeat whose end date has passed.');
  const starts: Array<[string, string, Timer, string?]> = [
    ['startDate', 'On 1 Jan 2035', { type: 'date', value: '2035-01-01T09:00:00Z' }],
    ['startCycle', 'Every hour, three times', { type: 'cycle', value: 'R3/PT1H', endDate: '2099-12-31T23:59:59Z' }],
    ['startCron', 'Daily at noon', { type: 'cycle', value: '0 0 12 * * ?' }, 'cycle'],
    ['startExpired', 'Repeat that has ended', { type: 'cycle', value: 'R3/PT1H', endDate: '2000-01-01T00:00:00Z' }],
  ];
  for (const [i, [id, name, timer, calendar]] of starts.entries()) {
    await api.createShape({ type: 'startEvent', id, name, eventDefinition: 'timer', at: at(0, i) });
    await api.setProperty(id, 'timer.definition', timer);
    if (calendar) await api.setProperty(id, 'timer.businessCalendarName', calendar);
  }
  await api.createShape({ type: 'serviceTask', id: 'work', name: 'Do the scheduled work', at: at(2, 1.5) });
  await api.setProperty('work', 'impl.type', 'expression');
  await api.setProperty('work', 'impl.expression', "${execution.setVariable('ran', true)}");
  await api.createShape({ type: 'endEvent', id: 'end', at: at(3, 1.5) });
  for (const [id] of starts) await api.connect(id, 'work', `f_${id}_work`);
  await api.connect('work', 'end', 'f_work_end');
}
