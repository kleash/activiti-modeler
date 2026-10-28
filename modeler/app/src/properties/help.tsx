/** @jsxImportSource @bpmn-io/properties-panel/preact */
import type { VNode } from '@bpmn-io/properties-panel/preact';

import { t } from '../i18n';

/** The user guide pages of the groups: `docs/user-guide/properties/<page>.md` in the repository. */
export const DOCS_BASE = 'https://github.com/kleash/activiti-modeler/blob/main/docs/user-guide/properties/';

export const docsUrl = (page: string, anchor?: string): string => `${DOCS_BASE}${page}.md${anchor ? `#${anchor}` : ''}`;

export interface Help {
  /** What the field means in Activiti. */
  text: string;
  /** How the engine treats it, when that is not obvious. */
  engine?: string;
  /** The page of the group in the user guide. */
  page: string;
  anchor?: string;
}

/** Short explanations of the groups (by group id) and of single entries (by entry id / accessor key). */
export const HELP: Record<string, Help> = {
  // --- groups
  general: { page: 'general', text: 'Name and identity of the element. The ID is the key other things refer to: the process ID is the process definition key; renaming an ID renames the entries of the extensions file too.', engine: 'Activiti runs only processes with isExecutable="true"; the modeler keeps that on.' },
  documentation: { page: 'documentation', text: 'Free text kept with the element.', engine: 'The documentation of a process becomes the description of its definition (at most 2000 characters).' },
  starters: { page: 'candidate-starters', text: 'Who may start an instance through ProcessRuntime. Without any starter everybody may.' },
  messages: { page: 'messages-signals-errors', text: 'Messages, signals and errors are declared once for the whole file and referred to by events. Deleting one clears the references to it.' },
  signals: { page: 'messages-signals-errors', text: 'A signal is a broadcast. Scope "global" reaches every process instance, "processInstance" only the instance that throws it.' },
  errors: { page: 'messages-signals-errors', text: 'An error is identified by its error code; error end events throw it and error boundary events and error start events catch it.' },
  eventListeners: { page: 'event-listeners', text: 'Engine event listeners of the process: called for the engine events you list (all events when none), optionally only for one entity type.' },
  executionListeners: { page: 'execution-listeners', text: 'Called when the process or element starts or ends, or when a sequence flow is taken. Listeners run in the order listed.' },
  startInitiator: { page: 'start-initiator-form', text: 'The initiator variable receives the id of the user who started the instance.', engine: 'The host application must call Authentication.setAuthenticatedUserId (ProcessRuntime does not copy the Spring Security user), or the variable stays empty.' },
  userAssignment: { page: 'user-assignment', text: 'Who works on the task: an assignee, or candidate users and groups who claim it.' },
  form: { page: 'form', text: 'A form key names the form a task or start event is shown with. The legacy form properties are kept for models that have them.', engine: 'Activiti 9 parses form properties and form keys but never acts on them.' },
  taskListeners: { page: 'task-listeners', text: 'Called on task events: create, assignment, complete, delete, or all of them.' },
  implementation: { page: 'implementation', text: 'What a service task does: call a Java class, evaluate an expression, call a delegate bean, run a connector, send mail, run a shell command or evaluate a decision.' },
  fields: { page: 'field-injection', text: 'Values injected into the fields of the Java class or delegate bean, as text or as an expression evaluated when the task runs.' },
  mail: { page: 'mail-shell-fields', text: 'The fields of a mail task. Texts can be literals or expressions.', engine: 'Without a "from" field the engine uses its default sender address; without one, sending fails.' },
  shell: { page: 'mail-shell-fields', text: 'The fields of a shell task: the command, up to five arguments and where to put the result.', engine: 'A non-zero exit code does not fail the task; read it from the exit code variable.' },
  script: { page: 'script', text: 'The script a script task runs, in JUEL (the default) or a JSR-223 language such as JavaScript.' },
  calledElement: { page: 'called-element', text: 'The process a call activity starts, and the variables passed in and back.' },
  multiInstance: { page: 'multi-instance', text: 'Runs the activity once per item of a collection, or a fixed number of times, in parallel or one after the other.' },
  async: { page: 'asynchronous-continuation', text: 'An asynchronous activity is executed by a job, in its own transaction. Exclusive jobs of one process instance never run at the same time.', engine: 'Needs the async executor; without it the job waits until something runs it.' },
  job: { page: 'job-execution', text: 'How often and when a failed job is retried before it becomes a dead-letter job.', engine: 'Only honoured on service tasks; elsewhere the default of 3 retries applies.' },
  errorMapping: { page: 'error-mapping', text: 'Turns an exception of the Java class into a BPMN error with an error code that error boundary events catch.', engine: 'Only wired for tasks that use a Java class, and for call activities.' },
  timer: { page: 'timer', text: 'When the timer fires: at a date, after a duration, or repeatedly on a cycle (ISO 8601 repeat or a Quartz cron expression).' },
  message: { page: 'event-definitions', anchor: 'message', text: 'The message this event sends or waits for.' },
  signal: { page: 'event-definitions', anchor: 'signal', text: 'The signal this event throws or waits for.' },
  error: { page: 'event-definitions', anchor: 'error', text: 'The error this event throws or catches, by error code.' },
  link: { page: 'event-definitions', anchor: 'link', text: 'A link throw event continues at the link catch event with the same name, like a goto within one process level.' },
  compensation: { page: 'event-definitions', anchor: 'compensation', text: 'Starts the compensation handlers of completed activities.' },
  terminate: { page: 'event-definitions', anchor: 'terminate', text: 'An end event that ends the whole process instance, or a scope.' },
  condition: { page: 'condition', text: 'The flow is taken when its condition is true. A default flow has no condition.' },
  skip: { page: 'skip-expression', text: 'When the expression is true the engine skips the element and takes the flow.', engine: 'Only evaluated when the process variable _ACTIVITI_SKIP_EXPRESSION_ENABLED is true.' },
  dataObject: { page: 'data-object', text: 'A data object is a process variable with a type and a default value, created when the process (or sub process) starts.' },
  variables: { page: 'process-variables', text: 'The variables the process declares: a type, an optional default, and whether a start must provide them.', engine: 'The engine writes an output mapping only to a declared variable (or one that already exists); a declared variable with a default is created when an instance starts.' },
  mapping: { page: 'input-output-mapping', text: 'Which variables a task receives and which of its results reach the process.', engine: 'Activiti 9 passes nothing in or out of a connector, user task, call activity or message event without an entry here.' },
  constants: { page: 'constants', text: 'Fixed values that arrive as inputs of the task next to the mapped inputs.' },
  decision: { page: 'decision', text: 'The DMN decision a decision task evaluates, and how the task is wired to what the decision reads and returns.', engine: 'The DMN connector reads its inputs from the mapped inputs and returns the output columns, the matched flag and the matched rule ids, which reach the process through the output mapping.' },
  template: { page: 'template', text: 'The element template this task was created from. A template sets the implementation, the mapping and the declared variables of a connector action or built-in task kind, and records its version so the modeler can tell when it is outdated.' },

  // --- entries
  'general.id': { page: 'general', text: 'The unique identifier: letters, digits, "_", "-" and "." only, not starting with a digit, at most 255 characters.' },
  'general.targetNamespace': { page: 'general', text: 'The namespace of the file. Activiti uses it as the category of the process definition.' },
  'documentation.text': { page: 'documentation', text: 'Notes for readers of the model.' },
  'starters.users': { page: 'candidate-starters', text: 'Comma separated user ids who may start the process.' },
  'starters.groups': { page: 'candidate-starters', text: 'Comma separated group ids whose members may start the process.' },
  'starters.potential': { page: 'candidate-starters', text: 'Starters as resource assignment: user(ann), group(clerks), or a bare name for a group.' },
  'start.initiator': { page: 'start-initiator-form', text: 'Name of the process variable that receives the user id of the starter.', engine: 'Set only when the host calls Authentication.setAuthenticatedUserId.' },
  'form.key': { page: 'form', text: 'The key of the form for this task or start event. Activiti keeps it in the model; the application decides what a key means.' },
  'form.properties': { page: 'form', text: 'Legacy form properties (activiti:formProperty). Kept for round trips of older models.', engine: 'Not executed by Activiti 9.' },
  'user.assignee': { page: 'user-assignment', text: 'The user who works on the task. A literal id or an expression such as ${initiator}.' },
  'user.owner': { page: 'user-assignment', text: 'The owner of the task: the user responsible for it, who may differ from the assignee.' },
  'user.candidateUsers': { page: 'user-assignment', text: 'Comma separated user ids who may claim the task, or an expression giving a string or a collection.' },
  'user.candidateGroups': { page: 'user-assignment', text: 'Comma separated group ids whose members may claim the task, or an expression giving a string or a collection.' },
  'user.dueDate': { page: 'user-assignment', text: 'When the task is due: an ISO 8601 duration (P2D, relative to the creation), an ISO 8601 date-time, or an expression.' },
  'user.priority': { page: 'user-assignment', text: 'The priority as a whole number, or an expression. The engine default is 0.' },
  'user.category': { page: 'user-assignment', text: 'A free category for the task.' },
  'user.businessCalendarName': { page: 'user-assignment', text: 'The business calendar that computes the due date: "dueDate" (default) or "duration" need no configuration.' },
  'user.humanPerformer': { page: 'user-assignment', text: 'The standard BPMN humanPerformer: the assignee as a resource assignment expression.', engine: 'Becomes the assignee of the task.' },
  'user.potentialOwner': { page: 'user-assignment', text: 'The standard BPMN potentialOwner: user(ann), user(carl), group(reviewers). A bare name is a group.', engine: 'Becomes candidate users and groups.' },
  'user.customResource': { page: 'user-assignment', text: 'A custom identity link type with its users and groups, for example "supervisor".', engine: 'A custom link does not make the task visible to those users through TaskRuntime.' },
  'impl.type': { page: 'implementation', text: 'How the service task does its work. Changing the type removes the settings of the previous one.' },
  'impl.class': { page: 'implementation', text: 'The fully qualified name of a Java class that implements JavaDelegate or ActivityBehavior.' },
  'impl.expression': { page: 'implementation', text: 'A JUEL expression evaluated when the task runs, for example ${orderService.ship(order)}.' },
  'impl.delegateExpression': { page: 'implementation', text: 'An expression that resolves to a delegate bean, for example ${shippingDelegate}.' },
  'impl.resultVariable': { page: 'implementation', text: 'The variable that receives the value of the expression.', engine: 'Only for expressions; a class or delegate with a result variable fails validation.' },
  'impl.connector': { page: 'implementation', text: 'The connector action as <connector>.<ACTION>, for example mailer.SEND. Inputs and outputs are mapped in the extensions.' },
  'script.format': { page: 'script', text: 'The script language: juel (the default) or javascript. Other languages need a JSR-223 engine on the classpath.' },
  'script.text': { page: 'script', text: 'In JUEL the script is one expression whose value goes to the result variable. In JavaScript write statements; the value of the last expression goes to the result variable.' },
  'script.resultVariable': { page: 'script', text: 'The variable that receives the value of the script.' },
  'script.autoStoreVariables': { page: 'script', text: 'Intended to store variables a script assigns as process variables.', engine: 'Has no effect with the bundled script engines; write variables with execution.setVariable(...).' },
  'call.calledElement': { page: 'called-element', text: 'The key of the process to call, or an expression that gives it.' },
  'call.businessKey': { page: 'called-element', text: 'An expression for the business key of the child instance.' },
  'call.inheritBusinessKey': { page: 'called-element', text: 'The child instance gets the business key of the caller.' },
  'call.inheritVariables': { page: 'called-element', text: 'The child instance starts with a copy of the caller\'s variables.' },
  'call.in': { page: 'called-element', text: 'Variables passed to the child: a source variable or an expression, and the target name in the child.' },
  'call.out': { page: 'called-element', text: 'Variables passed back: a child variable or an expression evaluated on the child, and the target name in the caller.' },
  'mi.type': { page: 'multi-instance', text: 'Sequential runs one instance after the other, parallel all at once.' },
  'mi.cardinality': { page: 'multi-instance', text: 'How many instances to run, as a number or an expression. Use this or a collection.' },
  'mi.collection': { page: 'multi-instance', text: 'A variable name or ${expression} that gives the collection to loop over.' },
  'mi.elementVariable': { page: 'multi-instance', text: 'The variable that holds the current item inside each instance.' },
  'mi.elementIndexVariable': { page: 'multi-instance', text: 'The variable that holds the index of the instance. The default is loopCounter.' },
  'mi.completionCondition': { page: 'multi-instance', text: 'Ends the loop early when true. Variables nrOfInstances, nrOfCompletedInstances and nrOfActiveInstances are available.' },
  'mi.outputCollection': { page: 'multi-instance', text: 'The variable that collects the output item of every instance.' },
  'mi.outputItem': { page: 'multi-instance', text: 'The variable of an instance whose value is collected.' },
  'async.async': { page: 'asynchronous-continuation', text: 'Run the activity in a separate transaction through a job.' },
  'async.exclusive': { page: 'asynchronous-continuation', text: 'Exclusive jobs of one process instance are executed one at a time (the default).' },
  'job.failedJobRetryTimeCycle': { page: 'job-execution', text: 'How often a failing job is tried and how long to wait: R5/PT10S is five attempts, ten seconds apart.' },
  'errors.mapExceptions': { page: 'error-mapping', text: 'The first matching entry in the order listed wins; an entry without a class matches any exception.' },
  'timer.definition.type': { page: 'timer', text: 'Date: fires once at a date-time. Duration: fires once after a time span. Cycle: repeats, as an ISO 8601 interval or a Quartz cron expression.' },
  'timer.definition.value': { page: 'timer', text: 'ISO 8601 date-time (2030-01-01T12:00:00Z), duration (PT30M, P2D), repeat (R3/PT1H) or Quartz cron (0 0 12 * * ?). An expression is allowed.' },
  'timer.definition.endDate': { page: 'timer', text: 'A repeating timer stops at this date-time (activiti:endDate).' },
  'timer.businessCalendarName': { page: 'timer', text: 'The business calendar to compute the time with: duration, dueDate or cycle.' },
  'message.ref': { page: 'event-definitions', anchor: 'message', text: 'The message of the file this event uses. Pick one or create a new one.' },
  'message.expression': { page: 'event-definitions', anchor: 'message', text: 'Names the message with an expression instead of a declared message.' },
  'message.correlationKey': { page: 'event-definitions', anchor: 'message', text: 'An expression for the correlation key that distinguishes subscriptions to the same message.' },
  'message.class': { page: 'event-definitions', anchor: 'message', text: 'The ThrowMessageDelegate class that sends the message when this event throws.' },
  'message.delegateExpression': { page: 'event-definitions', anchor: 'message', text: 'An expression for the delegate bean that sends the message.' },
  'message.fields': { page: 'event-definitions', anchor: 'message', text: 'Fields of the throw delegate.', engine: 'Parsed but never injected in Activiti 9.0.0; pass data with the input mapping instead.' },
  'signal.ref': { page: 'event-definitions', anchor: 'signal', text: 'The signal of the file this event uses. Pick one or create a new one.' },
  'signal.expression': { page: 'event-definitions', anchor: 'signal', text: 'Names the signal with an expression, such as ${\'go-\'.concat(region)}.', engine: 'A file that declares any signal fails to parse when an event names its signal by expression.' },
  'signal.async': { page: 'event-definitions', anchor: 'signal', text: 'Delivers the signal in a job instead of during the throw. Needs the async executor.' },
  'signal.scope': { page: 'event-definitions', anchor: 'signal', text: 'Global signals reach every process instance, processInstance signals only the throwing instance.' },
  'error.ref': { page: 'event-definitions', anchor: 'error', text: 'The error by its error code. An error boundary event without an error catches every error.' },
  'link.name': { page: 'event-definitions', anchor: 'link', text: 'The name of the link. A link throw event and the link catch event of the same name are connected.' },
  'link.target': { page: 'event-definitions', anchor: 'link', text: 'The link catch event this throw event continues at.' },
  'compensate.activityRef': { page: 'event-definitions', anchor: 'compensation', text: 'The compensation handler (or sub process) to compensate. Leave empty to compensate everything completed in this scope.', engine: 'Name the handler, not the compensated task: the subscription is keyed by the handler.' },
  'compensate.waitForCompletion': { page: 'event-definitions', anchor: 'compensation', text: 'Wait until the handlers are done.', engine: 'Parsed and ignored: the handlers always finish before the process moves on.' },
  'terminate.all': { page: 'event-definitions', anchor: 'terminate', text: 'Terminate the whole process instance, including parent scopes of called processes.' },
  'terminate.multiInstance': { page: 'event-definitions', anchor: 'terminate', text: 'Terminate all instances of the enclosing multi-instance activity.' },
  'flow.condition': { page: 'condition', text: 'A JUEL expression that is true or false, for example ${amount > 100}.' },
  'flow.default': { page: 'condition', text: 'The flow taken when no other condition of the gateway or activity is true.' },
  'skip.expression': { page: 'skip-expression', text: 'When true, the element is skipped.', engine: 'Declare the process variable _ACTIVITI_SKIP_EXPRESSION_ENABLED with the default true; it cannot be a start variable.' },
  'data.name': { page: 'data-object', text: 'The name of the data object is the name of the process variable.' },
  'variables.list': { page: 'process-variables', text: 'The declared variables, in the order the properties are written. A default is checked against the type.' },
  'mapping.type': { page: 'input-output-mapping', text: 'MAP_ALL passes every variable in and out; MAP_ALL_INPUTS only in, MAP_ALL_OUTPUTS only out. On a start or catch event MAP_ALL maps the payload.' },
  'mapping.inputs': { page: 'input-output-mapping', anchor: 'inputs', text: 'What the task receives: a name and where its value comes from, a process variable or a value (which may contain ${expressions}).', engine: 'A variable input is applied only when the variable is declared or exists. A value that is exactly ${...} keeps the type of the expression.' },
  'mapping.outputs': { page: 'input-output-mapping', anchor: 'outputs', text: 'Which result reaches which process variable: a variable of the result, a value, or a JSON patch of the current value of the variable.', engine: 'Applied only to declared variables; others are dropped silently. A null result is skipped.' },
  'mapping.ephemeral': { page: 'input-output-mapping', anchor: 'ephemeral', text: 'Marks the mapped variables transient for the connector.', engine: 'Only a flag the connector can read; the engine does nothing else with it.' },
  'constants.values': { page: 'constants', text: 'Name and value (text or JSON) of fixed inputs.' },
  'decision.pick': { page: 'decision', text: 'The decision of a DMN file of the project. Choosing one writes its id as the constant _activiti_dmn_table_ and maps its inputs and outputs.' },
  'decision.table': { page: 'decision', text: 'The id of the DMN decision to evaluate (the constant _activiti_dmn_table_). A DMN file name that holds one decision also works.' },
  'template.info': { page: 'template', text: 'The template the task was created from, with its version.' },
  'impl.connector.pick': { page: 'implementation', text: 'The connector actions of the project. Choosing one applies its template: it sets the implementation, maps the inputs and outputs and declares the variables the action returns.' },
  'data.type': { page: 'data-object', text: 'An XML schema type; it decides the Java type of the variable.' },
  'data.value': { page: 'data-object', text: 'The default value, as text; it is converted to the type.' },
};

/** The tooltip of an entry or group: what it means, how the engine treats it, and a link to the user guide page. */
export function helpTooltip(key: string): VNode | undefined {
  const help = HELP[key];
  if (!help) return undefined;
  return (
    <div class="activiti-tooltip">
      <p>{help.text}</p>
      {help.engine ? (
        <p>
          <strong>{t('help.engine')}</strong> {help.engine}
        </p>
      ) : null}
      <p>
        <a href={docsUrl(help.page, help.anchor)} target="_blank" rel="noopener noreferrer">
          {t('help.learnMore')}
        </a>
      </p>
    </div>
  );
}

export const docsLinkFor = (key: string): string | undefined => {
  const help = HELP[key];
  return help ? docsUrl(help.page, help.anchor) : undefined;
};
