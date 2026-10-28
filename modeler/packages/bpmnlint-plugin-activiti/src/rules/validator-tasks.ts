/** Mirrors of the ProcessValidator keys about listeners and tasks (service, send, script, mail, shell, dmn). */
import { defineRule, onTypes } from '../define';
import { allFlowElements, extensionValues, fieldsOf, is, isBlank, list, rootElements, str } from '../model';
import type { ME } from '../types';

const R1_7 = 'R1 §7 (ProcessValidator keys)';

const EVENT_TYPES = [
  'ENTITY_CREATED', 'ENTITY_INITIALIZED', 'ENTITY_UPDATED', 'ENTITY_DELETED', 'ENTITY_SUSPENDED', 'ENTITY_ACTIVATED', 'TIMER_SCHEDULED', 'TIMER_FIRED', 'JOB_CANCELED',
  'JOB_EXECUTION_SUCCESS', 'JOB_EXECUTION_FAILURE', 'JOB_RETRIES_DECREMENTED', 'CUSTOM', 'ENGINE_CREATED', 'ENGINE_CLOSED', 'ACTIVITY_STARTED', 'ACTIVITY_COMPLETED',
  'ACTIVITY_CANCELLED', 'ACTIVITY_SIGNALED', 'ACTIVITY_COMPENSATE', 'ACTIVITY_MESSAGE_SENT', 'ACTIVITY_MESSAGE_WAITING', 'ACTIVITY_MESSAGE_RECEIVED', 'ACTIVITY_ERROR_RECEIVED',
  'HISTORIC_ACTIVITY_INSTANCE_CREATED', 'HISTORIC_ACTIVITY_INSTANCE_ENDED', 'SEQUENCEFLOW_TAKEN', 'UNCAUGHT_BPMN_ERROR', 'VARIABLE_CREATED', 'VARIABLE_UPDATED', 'VARIABLE_DELETED',
  'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'PROCESS_STARTED', 'PROCESS_COMPLETED', 'PROCESS_COMPLETED_WITH_ERROR_END_EVENT', 'PROCESS_CANCELLED',
  'HISTORIC_PROCESS_INSTANCE_CREATED', 'HISTORIC_PROCESS_INSTANCE_ENDED', 'MEMBERSHIP_CREATED', 'MEMBERSHIP_DELETED', 'MEMBERSHIPS_DELETED',
];
export const ACTIVITI_EVENT_TYPES: readonly string[] = EVENT_TYPES;
export const ENTITY_TYPES = ['attachment', 'comment', 'execution', 'identity-link', 'job', 'process-definition', 'process-instance', 'task'] as const;
const THROW_EVENTS = ['signal', 'globalSignal', 'message', 'error'];

const listenerHasImplementation = (l: ME): boolean => !isBlank(str(l, 'class')) || !isBlank(str(l, 'expression')) || !isBlank(str(l, 'delegateExpression'));

/** The elements that can carry execution listeners: the process and every flow element. */
function executionListenerHolders(process: ME): ME[] {
  return [process, ...allFlowElements(process)];
}

const serviceImplementationType = (task: ME): 'class' | 'expression' | 'delegateExpression' | 'webservice' | 'implementation' | undefined => {
  if (!isBlank(str(task, 'activiti:class'))) return 'class';
  if (!isBlank(str(task, 'activiti:expression'))) return 'expression';
  if (!isBlank(str(task, 'activiti:delegateExpression'))) return 'delegateExpression';
  if (str(task, 'implementation') === '##WebService') return 'webservice';
  if (!isBlank(str(task, 'implementation'))) return 'implementation';
  return undefined;
};

const operationExists = (definitions: ME | undefined, id: string): boolean =>
  rootElements(definitions).some((r) => is(r, 'bpmn:Interface') && list(r, 'operations').some((o) => o.id === id));

const typeOf = (task: ME): string => (str(task, 'activiti:type') ?? '').toLowerCase();
const hasField = (task: ME, name: string): boolean => fieldsOf(task).some((f) => f.name === name);

const mailTask = (node: ME): boolean => (is(node, 'bpmn:ServiceTask') || is(node, 'bpmn:SendTask')) && typeOf(node) === 'mail';
const MAIL = '<serviceTask id="m" activiti:type="mail">';
const field = (name: string, value = 'x'): string => `<activiti:field name="${name}"><activiti:string>${value}</activiti:string></activiti:field>`;
const ext = (...inner: string[]): string => `<extensionElements>${inner.join('')}</extensionElements>`;

export const taskRules = [
  defineRule({
    id: 'execution-listener-implementation-missing',
    tag: 'V',
    key: 'EXECUTION_LISTENER_IMPLEMENTATION_MISSING',
    severity: 'error',
    title: 'An execution listener has no class, expression or delegate expression',
    why: 'The listener would be called but has nothing to call.',
    evidence: [R1_7],
    howToFix: 'Set **Java class**, **Expression** or **Delegate expression** on the listener.',
    entry: 'listeners.execution',
    serverKeys: ['EXECUTION_LISTENER_IMPLEMENTATION_MISSING'],
    check: onTypes('bpmn:Process', (process, api) => {
      for (const holder of executionListenerHolders(process)) {
        for (const listener of extensionValues(holder, 'activiti:ExecutionListener')) {
          if (!listenerHasImplementation(listener)) api.report(holder, `Execution listener (${str(listener, 'event') ?? 'no event'}) of ${holder.id} has no implementation`);
        }
      }
    }),
    bad: [{ body: `<task id="t">${ext('<activiti:executionListener event="start"/>')}</task>`, ids: ['t'] }],
    good: [{ body: `<task id="t">${ext('<activiti:executionListener event="start" class="a.B"/>')}</task>` }],
  }),
  defineRule({
    id: 'execution-listener-invalid-implementation-type',
    tag: 'V',
    key: 'EXECUTION_LISTENER_INVALID_IMPLEMENTATION_TYPE',
    severity: 'error',
    title: 'A transaction dependent execution listener uses an expression',
    why: '`onTransaction` (before-commit, committed, rolled-back) needs a delegate expression whose bean implements the transaction dependent listener interface; an expression is rejected, a class only works if it implements that interface (engine-findings C13.4).',
    evidence: [R1_7, 'engine-findings C13.4'],
    howToFix: 'Use a delegate expression, or remove `onTransaction`.',
    entry: 'listeners.execution',
    serverKeys: ['EXECUTION_LISTENER_INVALID_IMPLEMENTATION_TYPE'],
    check: onTypes('bpmn:Process', (process, api) => {
      for (const holder of executionListenerHolders(process)) {
        for (const listener of extensionValues(holder, 'activiti:ExecutionListener')) {
          if (!isBlank(str(listener, 'onTransaction')) && isBlank(str(listener, 'class')) && isBlank(str(listener, 'delegateExpression')) && !isBlank(str(listener, 'expression'))) {
            api.report(holder, `Execution listener of ${holder.id}: onTransaction does not work with an expression`);
          }
        }
      }
    }),
    bad: [{ body: `<task id="t">${ext('<activiti:executionListener event="end" expression="${x.y()}" onTransaction="committed"/>')}</task>`, ids: ['t'] }],
    good: [{ body: `<task id="t">${ext('<activiti:executionListener event="end" delegateExpression="${bean}" onTransaction="committed"/>')}</task>` }],
  }),
  defineRule({
    id: 'user-task-listener-implementation-missing',
    tag: 'V',
    key: 'USER_TASK_LISTENER_IMPLEMENTATION_MISSING',
    severity: 'error',
    title: 'A task listener has no class, expression or delegate expression',
    why: 'The listener would be called but has nothing to call.',
    evidence: [R1_7],
    howToFix: 'Set **Java class**, **Expression** or **Delegate expression** on the task listener.',
    entry: 'listeners.task',
    serverKeys: ['USER_TASK_LISTENER_IMPLEMENTATION_MISSING'],
    check: onTypes('bpmn:UserTask', (task, api) => {
      for (const listener of extensionValues(task, 'activiti:TaskListener')) {
        if (!listenerHasImplementation(listener)) api.report(task, `Task listener (${str(listener, 'event') ?? 'no event'}) of ${task.id} has no implementation`);
      }
    }),
    bad: [{ body: `<userTask id="u">${ext('<activiti:taskListener event="create"/>')}</userTask>`, ids: ['u'] }],
    good: [{ body: `<userTask id="u">${ext('<activiti:taskListener event="create" delegateExpression="${l}"/>')}</userTask>` }],
  }),
  defineRule({
    id: 'event-listener-implementation-missing',
    tag: 'V',
    key: 'EVENT_LISTENER_IMPLEMENTATION_MISSING',
    severity: 'error',
    title: 'A process event listener has no implementation',
    why: 'An event listener needs `class`, `delegateExpression` or `throwEvent`. An `expression` attribute is not read (the parser only knows those three), so a listener with only an expression has no implementation for the engine. EVENT_LISTENER_INVALID_IMPLEMENTATION, the other key one might expect for it, cannot be reached from XML.',
    evidence: [R1_7, 'R1 §4.8', 'engine-findings C13.6, V.4'],
    howToFix: 'Choose what the listener does in the **Event listeners** group of the process.',
    entry: 'listeners.event',
    serverKeys: ['EVENT_LISTENER_IMPLEMENTATION_MISSING'],
    check: onTypes('bpmn:Process', (process, api) => {
      for (const listener of extensionValues(process, 'activiti:EventListener')) {
        if (isBlank(str(listener, 'class')) && isBlank(str(listener, 'delegateExpression')) && isBlank(str(listener, 'throwEvent'))) {
          const attrs = (listener.$attrs ?? {}) as Record<string, string>;
          const expression = attrs['expression'] ?? attrs['activiti:expression'] ?? str(listener, 'expression');
          api.report(process, `An event listener of ${process.id} has no implementation${isBlank(expression) ? '' : '; Activiti does not read an expression on an event listener, use a delegate expression'}`);
        }
      }
    }),
    bad: [
      { body: ext('<activiti:eventListener events="TASK_CREATED"/>'), ids: ['p'] },
      { body: ext('<activiti:eventListener events="TASK_CREATED" expression="${x}"/>'), ids: ['p'], note: 'expression is not an implementation of an event listener (the engine says IMPLEMENTATION_MISSING)' },
    ],
    good: [{ body: ext('<activiti:eventListener events="TASK_CREATED" class="a.B"/>') }],
  }),
  defineRule({
    id: 'event-listener-invalid-throw-event-type',
    tag: 'V',
    key: 'EVENT_LISTENER_INVALID_THROW_EVENT_TYPE',
    severity: 'error',
    title: 'A process event listener throws something other than a signal, global signal, message or error',
    why: '`throwEvent` accepts signal, globalSignal, message and error.',
    evidence: [R1_7, 'R1 §4.8'],
    howToFix: 'Choose one of the four.',
    entry: 'listeners.event',
    serverKeys: ['EVENT_LISTENER_INVALID_THROW_EVENT_TYPE'],
    check: onTypes('bpmn:Process', (process, api) => {
      for (const listener of extensionValues(process, 'activiti:EventListener')) {
        const type = str(listener, 'throwEvent');
        if (type !== undefined && type !== '' && !THROW_EVENTS.includes(type)) api.report(process, `An event listener of ${process.id} throws "${type}"; use signal, globalSignal, message or error`);
      }
    }),
    bad: [{ body: ext('<activiti:eventListener events="TASK_CREATED" throwEvent="escalation"/>'), ids: ['p'] }],
    good: [{ body: ext('<activiti:eventListener events="TASK_CREATED" throwEvent="signal" signalName="s"/>') }],
  }),
  defineRule({
    id: 'service-task-missing-implementation',
    tag: 'V',
    key: 'SERVICE_TASK_MISSING_IMPLEMENTATION',
    severity: 'error',
    title: 'A service task has no implementation',
    why: 'A service task runs a Java class, an expression, a delegate expression, a built-in type (mail, shell) or a connector bean (`implementation`). Without one Activiti rejects the file. `camunda:class` and `camunda:delegateExpression` are not read, which is how an imported task ends up here.',
    evidence: [R1_7, 'R1 §0.1-1'],
    howToFix: 'Choose an **Implementation** type in the properties panel.',
    entry: 'impl.type',
    serverKeys: ['SERVICE_TASK_MISSING_IMPLEMENTATION'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (serviceImplementationType(task) === undefined && isBlank(str(task, 'activiti:type'))) api.report(task, `Service task ${task.id} has no implementation`);
    }),
    bad: [{ body: '<serviceTask id="s"/>', ids: ['s'] }, { body: '<serviceTask id="s" camunda:class="a.B"/>', ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" activiti:class="a.B"/><serviceTask id="e" activiti:expression="${x}"/><serviceTask id="c" implementation="crm.LOOKUP"/><serviceTask id="m" activiti:type="mail"/>' }],
  }),
  defineRule({
    id: 'service-task-invalid-type',
    tag: 'V',
    key: 'SERVICE_TASK_INVALID_TYPE',
    severity: 'error',
    title: 'A service task has an unknown activiti:type',
    why: 'Activiti knows mail, mule, camel, shell and dmn; any other type is rejected. (Of those only mail and shell work: see the unsupported service task type rule.)',
    evidence: [R1_7],
    howToFix: 'Use mail or shell, or choose another implementation.',
    entry: 'impl.type',
    serverKeys: ['SERVICE_TASK_INVALID_TYPE'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const type = typeOf(task);
      if (type && !['mail', 'mule', 'camel', 'shell', 'dmn'].includes(type)) api.report(task, `Service task ${task.id} has the type "${str(task, 'activiti:type')}"`);
    }),
    bad: [{ body: '<serviceTask id="s" activiti:type="external"/>', ids: ['s'] }],
    good: [{ body: `<serviceTask id="s" activiti:type="shell">${ext(field('command', 'ls'))}</serviceTask>` }],
  }),
  defineRule({
    id: 'service-task-result-var-name-with-delegate',
    tag: 'V',
    key: 'SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE',
    severity: 'error',
    title: 'A service task with a Java class or delegate expression has a result variable name',
    why: 'Only an expression can return a value to store; a delegate sets its own variables.',
    evidence: [R1_7],
    howToFix: 'Remove the **Result variable name**, or implement the task as an expression.',
    entry: 'impl.resultVariable',
    serverKeys: ['SERVICE_TASK_RESULT_VAR_NAME_WITH_DELEGATE'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const result = str(task, 'activiti:resultVariableName') ?? str(task, 'activiti:resultVariable');
      const kind = serviceImplementationType(task);
      if (!isBlank(result) && (kind === 'class' || kind === 'delegateExpression')) api.report(task, `Service task ${task.id} has a result variable but runs a ${kind === 'class' ? 'Java class' : 'delegate expression'}`);
    }),
    bad: [{ body: '<serviceTask id="s" activiti:class="a.B" activiti:resultVariableName="r"/>', ids: ['s'] }],
    good: [{ body: '<serviceTask id="s" activiti:expression="${x}" activiti:resultVariableName="r"/>' }],
  }),
  defineRule({
    id: 'service-task-webservice-invalid-operation-ref',
    tag: 'V',
    key: 'SERVICE_TASK_WEBSERVICE_INVALID_OPERATION_REF',
    severity: 'error',
    title: 'A web service task refers to an operation that does not exist',
    why: 'Web service tasks do not run in Activiti 9 (no CXF importer); the validator still checks the operation reference.',
    evidence: [R1_7, 'R1 §0.1-9'],
    howToFix: 'Replace the web service task by a connector or a Java class.',
    serverKeys: ['SERVICE_TASK_WEBSERVICE_INVALID_OPERATION_REF'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      const ref = str(task, 'operationRef');
      if (str(task, 'implementation') === '##WebService' && !isBlank(ref) && !operationExists(api.definitions, ref!)) api.report(task, `Web service task ${task.id} refers to the operation "${ref}", which does not exist`);
    }),
    bad: [{ body: '<serviceTask id="w" implementation="##WebService" operationRef="ghost"/>', ids: ['w'] }],
    good: [{ body: '<serviceTask id="s" implementation="crm.LOOKUP"/>' }],
  }),
  defineRule({
    id: 'send-task-invalid-implementation',
    tag: 'V',
    key: 'SEND_TASK_INVALID_IMPLEMENTATION',
    severity: 'error',
    title: 'A send task is not a mail task',
    why: 'Only the mail send task works in Activiti 9 (`activiti:type="mail"` with its fields); a send task without a type is rejected (L13).',
    evidence: [R1_7, 'R1 §3.3', 'R1 §7.1 L13'],
    howToFix: 'Set **Implementation** to Mail, or use a service task.',
    entry: 'impl.type',
    serverKeys: ['SEND_TASK_INVALID_IMPLEMENTATION'],
    check: onTypes('bpmn:SendTask', (task, api) => {
      if (isBlank(str(task, 'activiti:type')) && str(task, 'implementation') !== '##WebService') api.report(task, `Send task ${task.id} has no mail type`);
    }),
    bad: [{ body: '<sendTask id="s"/>', ids: ['s'] }],
    good: [{ body: `<sendTask id="s" activiti:type="mail">${ext(field('to'), field('text'))}</sendTask>` }],
  }),
  defineRule({
    id: 'send-task-invalid-type',
    tag: 'V',
    key: 'SEND_TASK_INVALID_TYPE',
    severity: 'error',
    title: 'A send task has a type other than mail, mule or camel',
    why: 'The validator knows three send task types (and mule / camel fail at deployment, see the unsupported service task type rule).',
    evidence: [R1_7],
    howToFix: 'Set the type to mail.',
    entry: 'impl.type',
    serverKeys: ['SEND_TASK_INVALID_TYPE'],
    check: onTypes('bpmn:SendTask', (task, api) => {
      const type = typeOf(task);
      if (type && !['mail', 'mule', 'camel'].includes(type)) api.report(task, `Send task ${task.id} has the type "${str(task, 'activiti:type')}"`);
    }),
    bad: [{ body: '<sendTask id="s" activiti:type="sms"/>', ids: ['s'] }],
    good: [{ body: `<sendTask id="s" activiti:type="mail">${ext(field('to'), field('text'))}</sendTask>` }],
  }),
  defineRule({
    id: 'send-task-webservice-invalid-operation-ref',
    tag: 'V',
    key: 'SEND_TASK_WEBSERVICE_INVALID_OPERATION_REF',
    severity: 'error',
    title: 'A web service send task refers to an operation that does not exist',
    why: 'Web service tasks do not run in Activiti 9; the validator still checks the operation reference.',
    evidence: [R1_7],
    howToFix: 'Replace the send task by a mail send task.',
    serverKeys: ['SEND_TASK_WEBSERVICE_INVALID_OPERATION_REF'],
    check: onTypes('bpmn:SendTask', (task, api) => {
      const ref = str(task, 'operationRef');
      if (str(task, 'implementation') === '##WebService' && !isBlank(ref) && !operationExists(api.definitions, ref!)) api.report(task, `Send task ${task.id} refers to the operation "${ref}", which does not exist`);
    }),
    bad: [{ body: '<sendTask id="w" implementation="##WebService" operationRef="ghost"/>', ids: ['w'] }],
    good: [{ body: `<sendTask id="s" activiti:type="mail">${ext(field('to'), field('text'))}</sendTask>` }],
  }),
  defineRule({
    id: 'script-task-missing-script',
    tag: 'V',
    key: 'SCRIPT_TASK_MISSING_SCRIPT',
    severity: 'error',
    title: 'A script task has no script',
    why: 'An empty script is rejected.',
    evidence: [R1_7],
    howToFix: 'Write the script in the **Script** group.',
    entry: 'script.text',
    serverKeys: ['SCRIPT_TASK_MISSING_SCRIPT'],
    check: onTypes('bpmn:ScriptTask', (task, api) => {
      if (isBlank(typeof task.get('script') === 'string' ? (task.get('script') as string) : undefined)) api.report(task, `Script task ${task.id} has no script`);
    }),
    bad: [{ body: '<scriptTask id="s" scriptFormat="javascript"/>', ids: ['s'] }],
    good: [{ body: '<scriptTask id="s" scriptFormat="javascript"><script>execution.setVariable("a", 1)</script></scriptTask>' }],
  }),
  defineRule({
    id: 'mail-task-no-recipient',
    tag: 'V',
    key: 'MAIL_TASK_NO_RECIPIENT',
    severity: 'error',
    title: 'A mail task has no "to" field',
    why: 'Mail tasks need a recipient.',
    evidence: [R1_7],
    howToFix: 'Add the field `to` in the **Mail** group.',
    entry: 'fields.list',
    serverKeys: ['MAIL_TASK_NO_RECIPIENT'],
    check: (node, api) => {
      if (mailTask(node) && !hasField(node, 'to')) api.report(node, `Mail task ${node.id} has no recipient (field "to")`);
    },
    bad: [{ body: `${MAIL}${ext(field('text'))}</serviceTask>`, ids: ['m'] }],
    good: [{ body: `${MAIL}${ext(field('to'), field('text'))}</serviceTask>` }],
  }),
  defineRule({
    id: 'mail-task-no-content',
    tag: 'V',
    key: 'MAIL_TASK_NO_CONTENT',
    severity: 'error',
    title: 'A mail task has no text, html, textVar or htmlVar field',
    why: 'A mail needs a body: the validator rejects a mail task that sets neither `text`, `html`, `textVar` nor `htmlVar`, because the mail behavior has nothing to send.',
    evidence: [R1_7],
    howToFix: 'Add one of the fields `text`, `html`, `textVar` or `htmlVar`.',
    entry: 'fields.list',
    serverKeys: ['MAIL_TASK_NO_CONTENT'],
    check: (node, api) => {
      if (mailTask(node) && !['text', 'html', 'textVar', 'htmlVar'].some((n) => hasField(node, n))) api.report(node, `Mail task ${node.id} has no content (text, html, textVar or htmlVar)`);
    },
    bad: [{ body: `${MAIL}${ext(field('to'))}</serviceTask>`, ids: ['m'] }],
    good: [{ body: `${MAIL}${ext(field('to'), field('html', '<b>x</b>'))}</serviceTask>` }],
  }),
  defineRule({
    id: 'shell-task-no-command',
    tag: 'V',
    key: 'SHELL_TASK_NO_COMMAND',
    severity: 'error',
    title: 'A shell task has no command field',
    why: 'A shell task runs the command in the field `command`.',
    evidence: [R1_7],
    howToFix: 'Add the field `command`.',
    entry: 'fields.list',
    serverKeys: ['SHELL_TASK_NO_COMMAND'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (typeOf(task) === 'shell' && !hasField(task, 'command')) api.report(task, `Shell task ${task.id} has no command`);
    }),
    bad: [{ body: `<serviceTask id="s" activiti:type="shell">${ext(field('arg1', 'x'))}</serviceTask>`, ids: ['s'] }],
    good: [{ body: `<serviceTask id="s" activiti:type="shell">${ext(field('command', 'ls'))}</serviceTask>` }],
  }),
  defineRule({
    id: 'shell-task-invalid-param',
    tag: 'V',
    key: 'SHELL_TASK_INVALID_PARAM',
    severity: 'error',
    title: 'A shell task has a wait, redirectError or cleanEnv field that is not true or false',
    why: 'These three fields are booleans; a literal other than `true` / `false` is rejected (an expression is not checked).',
    evidence: [R1_7],
    howToFix: 'Set the field to `true` or `false`.',
    entry: 'fields.list',
    serverKeys: ['SHELL_TASK_INVALID_PARAM'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (typeOf(task) !== 'shell') return;
      for (const f of fieldsOf(task)) {
        if (['wait', 'redirectError', 'cleanEnv'].includes(f.name) && !f.isExpression && f.value !== undefined && !['true', 'false'].includes(f.value.toLowerCase())) api.report(task, `Shell task ${task.id}: field ${f.name} is "${f.value}", not true or false`);
      }
    }),
    bad: [{ body: `<serviceTask id="s" activiti:type="shell">${ext(field('command', 'ls'), field('wait', 'yes'))}</serviceTask>`, ids: ['s'] }],
    good: [{ body: `<serviceTask id="s" activiti:type="shell">${ext(field('command', 'ls'), field('wait', 'false'))}</serviceTask>` }],
  }),
  defineRule({
    id: 'dmn-task-no-key',
    tag: 'V',
    key: 'DMN_TASK_NO_KEY',
    severity: 'error',
    title: 'A service task of type dmn has no decisionTableReferenceKey',
    why: 'The validator wants the field, but a service task with `activiti:type="dmn"` has no behaviour in Activiti 9 and is skipped at run time (R1 §0.1-3): use a Decision task instead.',
    evidence: [R1_7, 'R1 §0.1-3'],
    howToFix: 'Replace the task by a Decision task.',
    entry: 'impl.type',
    serverKeys: ['DMN_TASK_NO_KEY'],
    check: onTypes('bpmn:ServiceTask', (task, api) => {
      if (typeOf(task) === 'dmn' && !fieldsOf(task).some((f) => f.name === 'decisionTableReferenceKey' && !isBlank(f.value))) api.report(task, `Service task ${task.id} of type dmn has no decisionTableReferenceKey`);
    }),
    bad: [{ body: '<serviceTask id="dm" activiti:type="dmn"/>', ids: ['dm'] }],
    good: [{ body: `<serviceTask id="dm" activiti:type="dmn">${ext(field('decisionTableReferenceKey', 'rules'))}</serviceTask>` }],
  }),
];

export const taskHelpers = { serviceImplementationType, typeOf, hasField, executionListenerHolders, listenerHasImplementation };
