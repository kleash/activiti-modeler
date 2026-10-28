import type { CorpusModeler } from '../../modeler/e2e/support/modelerApi';
import { chain } from '../support/flows';
import { at } from '../support/layout';

/**
 * C01 user tasks, modelled through the real modeler (window.__modelerTestApi: the property accessors and diagram-js
 * commands the properties panel uses) and exported with the real export pipeline. It reproduces `seed/processes/*`;
 * the runner compares the result with the seed semantically and the harness runs the hand-written scenarios of this
 * folder against it.
 *
 * The project switches the default MAP_ALL of new user tasks off (ADR 0006): the scenarios observe exactly the
 * mappings the seed declares.
 */
const NAMESPACE = 'http://activiti.org/bpmn/corpus/C01';
const TASK_LISTENER = 'io.github.kleash.activiti.harness.support.RecordingTaskListener';
const FIELD_LISTENER = 'io.github.kleash.activiti.harness.support.FieldTaskListener';

async function newProcess(api: CorpusModeler, file: string, id: string, name: string, documentation: string, options: { omitExtensions?: boolean } = {}): Promise<void> {
  await api.newProcess(id, name, { file, ...options });
  await api.setProperty(id, 'general.targetNamespace', NAMESPACE);
  await api.setProperty(id, 'documentation.text', documentation);
}

/** start -> tasks... -> end laid out on one row; every task is a user task with the given name. */
async function userTasks(api: CorpusModeler, tasks: Array<{ id: string; name: string; attrs?: Record<string, string> }>, row = 1): Promise<void> {
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, row) });
  for (const [i, t] of tasks.entries()) await api.createShape({ type: 'userTask', id: t.id, name: t.name, at: at(i + 1, row) });
  await api.createShape({ type: 'endEvent', id: 'end', at: at(tasks.length + 1, row) });
  await chain(api, 'start', ...tasks.map((t) => t.id), 'end');
}

export default async function build(api: CorpusModeler): Promise<void> {
  await api.createProject('C01-user-tasks', { defaultMappings: 'none' });

  // --- assignment-forms ---------------------------------------------------------------------------------------------------
  await newProcess(api, 'assignment-forms', 'assignmentForms', 'Assignment forms',
    'One user task per way of saying who works on it: assignee and owner, an expression, candidate users and groups, candidates from expressions (a collection and a comma separated string), the standard humanPerformer and potentialOwner elements and an activiti:customResource identity link.');
  await userTasks(api, [
    { id: 'byAssignee', name: 'Assignee and owner' },
    { id: 'byExpression', name: 'Assignee from ${reviewer}' },
    { id: 'byCandidates', name: 'Candidate users and groups' },
    { id: 'byCandidateExpressions', name: 'Candidates from expressions' },
    { id: 'byHumanPerformer', name: 'Human performer' },
    { id: 'byPotentialOwner', name: 'Potential owner' },
    { id: 'byCustomResource', name: 'Custom resource' },
  ]);
  await api.setProperty('byAssignee', 'user.assignee', 'ann');
  await api.setProperty('byAssignee', 'user.owner', 'bob');
  await api.setProperty('byExpression', 'user.assignee', '${reviewer}');
  await api.setProperty('byCandidates', 'user.candidateUsers', 'ann, bob');
  await api.setProperty('byCandidates', 'user.candidateGroups', 'reviewers, clerks');
  await api.setProperty('byCandidateExpressions', 'user.candidateUsers', '${approvers}');
  await api.setProperty('byCandidateExpressions', 'user.candidateGroups', '${groupNames}');
  await api.setProperty('byHumanPerformer', 'user.humanPerformer', 'carl');
  await api.setProperty('byPotentialOwner', 'user.potentialOwner', 'user(ann), user(carl), group(reviewers)');
  await api.setProperty('byCustomResource', 'user.candidateUsers', 'ann');
  await api.setProperty('byCustomResource', 'user.customResource', [{ name: 'supervisor', expression: 'user(dave), group(managers)' }]);

  // --- candidate-starters -------------------------------------------------------------------------------------------------
  await newProcess(api, 'candidate-starters', 'candidateStarters', 'Candidate starters',
    'Only the users ann and bob and the members of the group clerks may start an instance through ProcessRuntime. The starters are identity links of the process definition.');
  await api.setProperty('candidateStarters', 'starters.users', 'ann, bob');
  await api.setProperty('candidateStarters', 'starters.groups', 'clerks');
  await userTasks(api, [{ id: 'work', name: 'Work for ${starter}' }]);
  await api.setProperty('start', 'start.initiator', 'starter');
  await api.setProperty('start', 'form.key', 'startForm');
  await api.setProperty('work', 'user.assignee', '${starter}');

  // --- multi-instance-parallel --------------------------------------------------------------------------------------------
  await newProcess(api, 'multi-instance-parallel', 'reviewParallel', 'Parallel multi-instance user task',
    'A parallel multi-instance user task over the process variable reviewers (a collection named by activiti:collection). Each instance has the element variable reviewer and an assignee taken from it; the input mapping gives every task the local variables assignedTo and rule. The completion variable verdict is local to the instance and the outputDataItem collects it into verdicts (in completion order); the completion condition ends the loop once quorum instances are done and cancels the open ones.');
  await userTasks(api, [
    { id: 'reviewEach', name: 'Review by ${reviewer}' },
    { id: 'summarize', name: 'Summarize' },
  ]);
  await api.setProperty('reviewEach', 'user.assignee', '${reviewer}');
  await api.setProperty('reviewEach', 'mi.type', 'parallel');
  await api.setProperty('reviewEach', 'mi.collection', 'reviewers');
  await api.setProperty('reviewEach', 'mi.elementVariable', 'reviewer');
  await api.setProperty('reviewEach', 'mi.outputCollection', 'verdicts');
  await api.setProperty('reviewEach', 'mi.outputItem', 'verdict');
  await api.setProperty('reviewEach', 'mi.completionCondition', '${nrOfCompletedInstances >= quorum}');
  await api.setProperty('summarize', 'user.candidateUsers', 'ann');
  await api.setExtensions({ properties: [{ name: 'quorum', type: 'integer' }] });
  await api.setExtensions({ elementId: 'reviewEach', inputs: { assignedTo: { type: 'VARIABLE', value: 'reviewer' }, rule: { type: 'VALUE', value: 'four-eyes' } } });
  await api.setExtensions({ elementId: 'summarize', inputs: { verdicts: { type: 'VARIABLE', value: 'verdicts' } } });

  // --- multi-instance-sequential ------------------------------------------------------------------------------------------
  await newProcess(api, 'multi-instance-sequential', 'reviewSequential', 'Sequential multi-instance user task',
    'A sequential multi-instance user task over a collection given as an expression, with a custom element index variable (position, starting at 0) and a completion condition on nrOfCompletedInstances; then a sequential multi-instance user task driven by a loop cardinality and the default index variable loopCounter.');
  await userTasks(api, [
    { id: 'approveInTurn', name: 'Approval ${position + 1} by ${approver}' },
    { id: 'signOff', name: 'Sign-off ${loopCounter + 1}' },
  ]);
  await api.setProperty('approveInTurn', 'user.assignee', '${approver}');
  await api.setProperty('approveInTurn', 'mi.type', 'sequential');
  await api.setProperty('approveInTurn', 'mi.collection', '${approvers}');
  await api.setProperty('approveInTurn', 'mi.elementVariable', 'approver');
  await api.setProperty('approveInTurn', 'mi.elementIndexVariable', 'position');
  await api.setProperty('approveInTurn', 'mi.completionCondition', '${nrOfCompletedInstances >= limit}');
  await api.setProperty('signOff', 'user.candidateUsers', 'ann');
  await api.setProperty('signOff', 'mi.type', 'sequential');
  await api.setProperty('signOff', 'mi.cardinality', '2');
  await api.setExtensions({ properties: [{ name: 'limit', type: 'integer' }] });
  await api.setExtensions({ elementId: 'approveInTurn', inputs: { turn: { type: 'VARIABLE', value: 'position' } } });

  // --- skip-disabled / skip-enabled ---------------------------------------------------------------------------------------
  const skipDocs = {
    skipDisabled: 'Same task as skipEnabled but the variable _ACTIVITI_SKIP_EXPRESSION_ENABLED is not set: a skipExpression is ignored and the task always waits.',
    skipEnabled:
      'The process variable _ACTIVITI_SKIP_EXPRESSION_ENABLED is declared as a property with the default true (it cannot be a start variable: ProcessRuntime rejects names that start with an underscore), so a true skipExpression makes the engine create the task, run its create and delete listeners and leave without waiting.',
  };
  for (const [file, id, name] of [['skip-disabled', 'skipDisabled', 'Skip expression disabled'], ['skip-enabled', 'skipEnabled', 'Skip expression enabled']] as const) {
    await newProcess(api, file, id, name, skipDocs[id]);
    await userTasks(api, [{ id: 'review', name: 'Review' }]);
    await api.setProperty('review', 'user.candidateUsers', 'ann');
    await api.setProperty('review', 'skip.expression', '${skipReview}');
    await api.setProperty('review', 'listeners.task', [
      { event: 'create', class: TASK_LISTENER },
      { event: 'complete', class: TASK_LISTENER },
      { event: 'delete', class: TASK_LISTENER },
    ]);
  }
  await api.setExtensions({ properties: [{ name: '_ACTIVITI_SKIP_EXPRESSION_ENABLED', type: 'boolean', value: true }] });

  // --- task-attributes ----------------------------------------------------------------------------------------------------
  await newProcess(api, 'task-attributes', 'taskAttributes', 'Task attributes',
    'Priority, category, form key and due date of a user task: literal values, expressions, a due date as a duration or as a date, and the two business calendars that need no configuration (dueDate, duration).');
  await userTasks(api, [
    { id: 'literal', name: 'Literal attributes' },
    { id: 'expressions', name: 'Review ${customerId}' },
    { id: 'durationCalendar', name: 'Duration calendar' },
    { id: 'dueDateCalendar', name: 'Due date calendar' },
    { id: 'plain', name: 'Nothing set' },
  ]);
  await api.setProperty('literal', 'documentation.text', 'Please review the loan.');
  await api.setProperty('expressions', 'documentation.text', 'Review the loan of ${customerId}.');
  for (const id of ['literal', 'expressions', 'durationCalendar', 'dueDateCalendar', 'plain']) await api.setProperty(id, 'user.candidateUsers', 'ann');
  await api.setProperty('literal', 'user.priority', '80');
  await api.setProperty('literal', 'user.category', 'credit');
  await api.setProperty('literal', 'form.key', 'reviewForm');
  await api.setProperty('literal', 'user.dueDate', 'P2D');
  await api.setProperty('expressions', 'user.priority', '${urgency}');
  await api.setProperty('expressions', 'user.category', '${area}');
  await api.setProperty('expressions', 'form.key', '${formName}');
  await api.setProperty('expressions', 'user.dueDate', '${deadline}');
  await api.setProperty('durationCalendar', 'user.businessCalendarName', 'duration');
  await api.setProperty('durationCalendar', 'user.dueDate', 'PT4H');
  await api.setProperty('dueDateCalendar', 'user.businessCalendarName', 'dueDate');
  await api.setProperty('dueDateCalendar', 'user.dueDate', '2030-02-01T12:30:00Z');

  // --- task-listeners -----------------------------------------------------------------------------------------------------
  await newProcess(api, 'task-listeners', 'taskListeners', 'Task listeners',
    'Task listeners of every implementation type (class, delegate expression, expression) and every event (create, assignment, complete, delete, all), with fields. A task with an assignee fires assignment before create; a claimed task fires create before assignment; completing fires complete and then delete.');
  await userTasks(api, [
    { id: 'listened', name: 'Assigned task' },
    { id: 'claimed', name: 'Claimed task' },
  ]);
  await api.setProperty('listened', 'user.assignee', 'ann');
  await api.setProperty('listened', 'listeners.task', [
    { event: 'create', class: TASK_LISTENER },
    { event: 'assignment', delegateExpression: '${recordingTaskListener}' },
    { event: 'complete', class: TASK_LISTENER },
    { event: 'delete', class: TASK_LISTENER },
    { event: 'complete', expression: "${execution.setVariable('completedBy', task.assignee)}" },
    { event: 'all', class: FIELD_LISTENER, fields: [{ name: 'tag', string: 'any' }] },
    { event: 'create', class: FIELD_LISTENER, fields: [{ name: 'tag', expression: '${customerId}' }] },
  ]);
  await api.setProperty('claimed', 'user.candidateGroups', 'reviewers');
  await api.setProperty('claimed', 'listeners.task', [
    { event: 'create', class: TASK_LISTENER },
    { event: 'assignment', delegateExpression: '${recordingTaskListener}' },
    { event: 'complete', class: TASK_LISTENER },
    { event: 'delete', class: TASK_LISTENER },
  ]);

  // --- task-mappings ------------------------------------------------------------------------------------------------------
  await newProcess(api, 'task-mappings', 'taskMappings', 'Task mappings',
    'Input mappings become task-local variables (a variable, a literal, an expression and a constant); output mappings copy completion variables (and the engine-provided sys_task_assignee) to process variables. A task without a mapping gets no task-local variables and its completion variables are dropped; MAP_ALL passes everything in both directions.');
  await userTasks(api, [
    { id: 'approve', name: 'Approve' },
    { id: 'unmapped', name: 'Unmapped' },
    { id: 'passAll', name: 'Pass everything' },
  ]);
  for (const id of ['approve', 'unmapped', 'passAll']) await api.setProperty(id, 'user.candidateUsers', 'ann');
  await api.setExtensions({
    properties: [
      { name: 'customerId', type: 'string' },
      { name: 'amount', type: 'integer' },
      { name: 'approved', type: 'boolean' },
      { name: 'reviewerComment', type: 'string' },
      { name: 'stamp', type: 'string' },
      { name: 'completedBy', type: 'string' },
    ],
    elementId: 'approve',
    inputs: {
      amount: { type: 'VARIABLE', value: 'amount' },
      currency: { type: 'VALUE', value: 'EUR' },
      who: { type: 'VALUE', value: '${customerId}' },
      label: { type: 'VALUE', value: 'Loan of ${customerId}' },
    },
    outputs: {
      approved: { type: 'VARIABLE', value: 'approved' },
      reviewerComment: { type: 'VARIABLE', value: 'comment' },
      stamp: { type: 'VALUE', value: 'reviewed' },
      completedBy: { type: 'VARIABLE', value: 'sys_task_assignee' },
    },
    constants: { limit: 1000 },
  });
  await api.setExtensions({ elementId: 'passAll', mappingType: 'MAP_ALL' });

  // --- no-extensions-file: the seed has no -extensions.json, so neither has the export -----------------------------------
  await newProcess(api, 'no-extensions-file', 'noExtensionsFile', 'No extensions file',
    'Deployed without a -extensions.json file. The variables the user task is completed with do not reach the process, so the gateway cannot read approved and the completion fails; variables given at the start reach the process.',
    { omitExtensions: true });
  await api.createShape({ type: 'startEvent', id: 'start', at: at(0, 1) });
  await api.createShape({ type: 'userTask', id: 'review', name: 'Review', at: at(1, 1) });
  await api.createShape({ type: 'exclusiveGateway', id: 'decided', name: 'Approved?', at: at(2, 1) });
  await api.createShape({ type: 'endEvent', id: 'approvedEnd', name: 'Approved', at: at(3, 0) });
  await api.createShape({ type: 'endEvent', id: 'rejectedEnd', name: 'Rejected', at: at(3, 2) });
  // each flow gets its condition or default marker right after it is drawn, while it is still selected (as in C04)
  await chain(api, 'start', 'review', 'decided', 'approvedEnd');
  await api.setProperty('f_decided_approvedEnd', 'flow.condition', '${approved}');
  await api.connect('decided', 'rejectedEnd', 'f_decided_rejectedEnd');
  await api.setProperty('f_decided_rejectedEnd', 'flow.default', true);
  await api.setProperty('review', 'user.assignee', 'ann');
}

/** Also built through the real UI by the corpus run (`modeler/e2e/support/uiModeler.ts`), into `target/corpus-ui/C01-user-tasks`. */
export const uiDriven = true;
