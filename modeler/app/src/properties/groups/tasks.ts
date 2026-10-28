import { implementationTypeOf, type CallParameter, type CustomResourceValue, type FormPropertyValue, type ImplementationType } from '@activiti-modeler/bpmn-js-activiti';

import { group, type Definition, type EntryBuilder } from '../builders';
import type { Row, RowColumn } from '../components/RowsEntry';
import { classNameProblem, variableNameProblem } from '../validation/ids';
import { error } from '../validation/types';
import { connectorDiagnostic, dueDateDiagnostic, expressionDiagnostic, idListDiagnostic, priorityDiagnostic, processKeyDiagnostic, resourceDiagnostic } from '../validation/values';
import { blankField, FIELD_COLUMNS, fieldFromRow, fieldRow, missingField } from './fields';

// --- user assignment ---------------------------------------------------------------------------------------------------------------

const CUSTOM_RESOURCE_COLUMNS: RowColumn[] = [
  { key: 'name', kind: 'text', label: 'Identity link type', placeholder: 'supervisor' },
  { key: 'expression', kind: 'text', label: 'Users and groups', placeholder: 'user(dave), group(managers)', validate: (v) => resourceDiagnostic(v) },
];

export function userGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'user.assignee')) return [];
  const entries: Definition[] = [
    b.juel({ key: 'user.assignee', label: 'Assignee', placeholder: 'ann or ${initiator}' }),
    b.text({ key: 'user.owner', label: 'Owner', validate: expressionDiagnostic }),
    b.juel({ key: 'user.candidateUsers', label: 'Candidate users', placeholder: 'ann, bob or ${approvers}', validate: idListDiagnostic, description: 'Comma separated, or an expression that gives a string or a collection.' }),
    b.juel({ key: 'user.candidateGroups', label: 'Candidate groups', placeholder: 'reviewers, clerks', validate: idListDiagnostic }),
    b.juel({ key: 'user.dueDate', label: 'Due date', placeholder: 'P2D', validate: dueDateDiagnostic }),
    b.text({ key: 'user.priority', label: 'Priority', placeholder: '0', description: 'Leave empty for the engine default, 0 (Task.DEFAULT_PRIORITY).', validate: priorityDiagnostic }),
    b.text({ key: 'user.category', label: 'Category', validate: expressionDiagnostic }),
    b.text({ key: 'user.businessCalendarName', label: 'Business calendar', placeholder: 'dueDate', description: 'Leave empty for the default calendar.' }),
    b.text({ key: 'user.humanPerformer', label: 'Human performer (standard BPMN)', placeholder: 'ann', validate: resourceDiagnostic }),
    b.text({ key: 'user.potentialOwner', label: 'Potential owner (standard BPMN)', placeholder: 'user(ann), group(reviewers)', validate: resourceDiagnostic }),
    b.rows<CustomResourceValue>({
      key: 'user.customResource',
      label: 'Custom identity links',
      addLabel: 'Add identity link',
      columns: CUSTOM_RESOURCE_COLUMNS,
      toRow: (v) => ({ name: v.name, expression: v.expression }),
      fromRow: (r) => ({ name: String(r['name']), expression: String(r['expression'] ?? '') }),
      blank: () => ({ name: '', expression: '' }),
      missing: (r) => (!r['name'] ? 'An identity link needs a type name' : !r['expression'] ? 'It needs users or groups' : undefined),
      rowTitle: (r) => String(r['name'] ?? ''),
    }),
  ];
  return [group({ id: 'userAssignment', label: 'User assignment', entries, shouldOpen: true })];
}

// --- start initiator / form -----------------------------------------------------------------------------------------------------------

const FORM_PROPERTY_TYPES = ['', 'string', 'long', 'double', 'boolean', 'date', 'enum'].map((t) => ({ value: t, label: t === '' ? '(none)' : t }));
const TRISTATE = [{ value: '', label: 'Default' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }];

const FORM_PROPERTY_COLUMNS: RowColumn[] = [
  { key: 'id', kind: 'text', label: 'Id', placeholder: 'customer' },
  { key: 'name', kind: 'text', label: 'Name' },
  { key: 'type', kind: 'select', label: 'Type', options: FORM_PROPERTY_TYPES },
  { key: 'values', kind: 'text', label: 'Enum values', placeholder: 'a=Alpha, b=Beta', when: (r) => r['type'] === 'enum' },
  { key: 'variable', kind: 'text', label: 'Variable' },
  { key: 'expression', kind: 'text', label: 'Expression' },
  { key: 'default', kind: 'text', label: 'Default' },
  { key: 'datePattern', kind: 'text', label: 'Date pattern', when: (r) => r['type'] === 'date' },
  { key: 'required', kind: 'select', label: 'Required', options: TRISTATE },
  { key: 'readable', kind: 'select', label: 'Readable', options: TRISTATE },
  { key: 'writable', kind: 'select', label: 'Writable', options: TRISTATE },
];

const SCALAR_FORM_KEYS = ['id', 'name', 'type', 'variable', 'expression', 'default', 'datePattern', 'required', 'readable', 'writable'] as const;
const formatValues = (values: FormPropertyValue['values']): string => (values ?? []).map((v) => (v.name !== undefined ? `${v.id ?? ''}=${v.name}` : (v.id ?? ''))).join(', ');
const parseValues = (text: string): FormPropertyValue['values'] =>
  text
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const at = p.indexOf('=');
      return at === -1 ? { id: p } : { id: p.slice(0, at).trim(), name: p.slice(at + 1).trim() };
    });

function formProperties(b: EntryBuilder): Definition {
  return b.rows<FormPropertyValue>({
    key: 'form.properties',
    label: 'Form properties (not executed by Activiti 9)',
    addLabel: 'Add form property',
    columns: FORM_PROPERTY_COLUMNS,
    toRow: (v) => ({ ...Object.fromEntries(SCALAR_FORM_KEYS.map((k) => [k, v[k] ?? ''])), values: formatValues(v.values) }),
    fromRow: (r) => {
      const value: FormPropertyValue = { id: String(r['id']) };
      for (const k of SCALAR_FORM_KEYS) if (k !== 'id' && r[k] !== undefined && r[k] !== '') value[k] = String(r[k]);
      if (r['type'] === 'enum' && r['values']) value.values = parseValues(String(r['values']));
      return value;
    },
    blank: () => Object.fromEntries([...SCALAR_FORM_KEYS.map((k) => [k, '']), ['values', '']]),
    missing: (r) => (r['id'] ? undefined : 'A form property needs an id'),
    rowTitle: (r) => String(r['id'] || r['name'] || ''),
    reorder: true,
  });
}

export function formGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  const out: Array<Definition | undefined> = [];
  const isStart = element.type === 'bpmn:StartEvent';
  if (isStart && env.has(element, 'start.initiator')) {
    out.push(
      group({
        id: 'startInitiator',
        label: 'Start initiator / form',
        entries: [
          b.text({ key: 'start.initiator', label: 'Initiator variable', placeholder: 'starter', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
          b.info('start.initiator.hint', 'The variable is only set when the host application calls Authentication.setAuthenticatedUserId (ProcessRuntime does not copy the Spring Security user into the engine).', 'warning', 'start.initiator'),
          b.text({ key: 'form.key', label: 'Form key', validate: expressionDiagnostic }),
        ],
        shouldOpen: true,
      }),
    );
  }
  if (env.has(element, 'form.properties')) {
    const entries: Definition[] = [];
    if (!isStart) entries.push(b.text({ key: 'form.key', label: 'Form key', validate: expressionDiagnostic }));
    entries.push(b.info('form.properties.hint', 'Form keys and form properties are parsed into the model and never enforced by Activiti 9: a start without a "required" property succeeds. The properties are kept so that imported models stay intact.', 'info', 'form.properties'));
    entries.push(formProperties(b));
    out.push(group({ id: 'form', label: 'Form', entries }));
  }
  return out;
}

// --- implementation ---------------------------------------------------------------------------------------------------------------------

const TYPE_OPTIONS: Array<{ value: ImplementationType; label: string }> = [
  { value: 'none', label: '(choose how the task works)' },
  { value: 'connector', label: 'Connector' },
  { value: 'class', label: 'Java class' },
  { value: 'expression', label: 'Expression' },
  { value: 'delegateExpression', label: 'Delegate expression' },
  { value: 'mail', label: 'Mail' },
  { value: 'shell', label: 'Shell' },
  { value: 'decision', label: 'Decision (DMN)' },
];

export function implementationGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'impl.type')) return [];
  const type = implementationTypeOf(element);
  const isSend = element.type === 'bpmn:SendTask';
  const options = isSend ? TYPE_OPTIONS.filter((o) => o.value === 'none' || o.value === 'mail') : TYPE_OPTIONS;
  const entries: Definition[] = [b.select({ key: 'impl.type', label: 'Implementation', options, read: (raw) => String(raw ?? 'none'), write: (text) => text ?? 'none' })];

  if (type === 'class') {
    entries.push(b.text({ key: 'impl.class', label: 'Java class', placeholder: 'com.example.MyDelegate', validate: (v) => (v ? classNameProblem(v) : error('A service task with a Java class needs the class name.')) }));
  } else if (type === 'expression') {
    entries.push(b.juel({ key: 'impl.expression', label: 'Expression', placeholder: '${orderService.ship(order)}', validate: (v) => (v ? undefined : error('Enter the expression to evaluate.')) }));
    entries.push(b.text({ key: 'impl.resultVariable', label: 'Result variable name', validate: (v) => (v ? variableNameProblem(v) : undefined) }));
  } else if (type === 'delegateExpression') {
    entries.push(b.juel({ key: 'impl.delegateExpression', label: 'Delegate expression', placeholder: '${shippingDelegate}', validate: (v) => (v ? undefined : error('Enter the expression that gives the delegate bean.')) }));
  } else if (type === 'connector') {
    const actions = env.catalog.actions();
    if (actions.length > 0) {
      const current = (env.get<string | undefined>(element, 'impl.connector') ?? '') as string;
      entries.push(
        b.selectRaw({
          id: 'impl.connector.pick',
          label: 'Connector action of the project',
          value: current,
          options: [{ value: '', label: '(choose an action)' }, ...actions.map((a) => ({ value: a.implementation, label: `${a.implementation}: ${a.action.name || a.action.id}` }))],
          description: 'Choosing an action applies its template: the inputs and outputs are mapped and the variables it returns are declared.',
          commit: (value) => {
            if (value !== undefined) env.write(element, 'template.apply', { id: value }, 'impl.connector.pick');
          },
        }),
      );
    } else {
      entries.push(b.info('impl.connector.empty', 'The project has no connector definitions. Add one under connectors/ (File > New file > Connector definition) to pick its actions here.', 'info', 'impl.connector.pick'));
    }
    entries.push(b.text({ key: 'impl.connector', label: 'Connector action', placeholder: 'mailer.SEND', validate: connectorDiagnostic }));
    entries.push(b.info('impl.connector.hint', 'Map the inputs and outputs of the connector in the input / output mapping below. A connector task needs a name: it becomes the client name of the call.', 'info', 'impl.connector'));
  } else if (type === 'decision') {
    entries.push(b.info('impl.decision.hint', 'The decision to evaluate and its mapping are in the Decision group below.', 'info', 'decision.pick'));
  } else if (type === 'mail') {
    entries.push(b.info('impl.mail.hint', 'The mail fields are below. Without a "from" field the engine uses its default sender address; without one, sending fails.', 'info', 'mail'));
  } else if (type === 'shell') {
    entries.push(b.info('impl.shell.hint', 'The shell fields are below. A non-zero exit code does not fail the task.', 'info', 'shell'));
  }
  return [group({ id: 'implementation', label: 'Implementation', entries, shouldOpen: true })];
}

/** Field injection of a service task that calls a Java class or a delegate bean. */
export function fieldGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'fields.list') || element.type !== 'bpmn:ServiceTask') return [];
  const type = implementationTypeOf(element);
  if (type !== 'class' && type !== 'delegateExpression') return [];
  return [
    group({
      id: 'fields',
      label: 'Field injection',
      entries: [
        b.rows({
          key: 'fields.list',
          label: 'Fields',
          addLabel: 'Add field',
          columns: FIELD_COLUMNS,
          toRow: fieldRow,
          fromRow: fieldFromRow,
          blank: blankField,
          missing: missingField,
          rowTitle: (r) => String(r['name'] ?? ''),
        }),
      ],
    }),
  ];
}

// --- mail and shell fields ---------------------------------------------------------------------------------------------------------------

const BOOLEAN_SUGGESTIONS = ['true', 'false'] as const;

const MAIL_FIELDS: Array<{ name: string; label: string; placeholder?: string; suggestions?: readonly string[]; description?: string }> = [
  { name: 'to', label: 'To', placeholder: 'customer@example.com or ${customerEmail}' },
  { name: 'from', label: 'From', description: 'Without a from address the engine uses its default sender.' },
  { name: 'cc', label: 'Cc' },
  { name: 'bcc', label: 'Bcc' },
  { name: 'subject', label: 'Subject' },
  { name: 'text', label: 'Text' },
  { name: 'textVar', label: 'Text variable', description: 'The name of a variable whose content is the text; ${...} in the content is evaluated when the mail is sent.' },
  { name: 'html', label: 'HTML' },
  { name: 'htmlVar', label: 'HTML variable', description: 'The name of a variable whose content is the HTML.' },
  { name: 'charset', label: 'Charset', suggestions: ['UTF-8', 'ISO-8859-1', 'US-ASCII'] },
  { name: 'ignoreException', label: 'Ignore exceptions', suggestions: BOOLEAN_SUGGESTIONS, description: 'true swallows every failure of the task and stores its message in the exception variable.' },
  { name: 'exceptionVariableName', label: 'Exception variable name' },
  { name: 'attachments', label: 'Attachments' },
];

const SHELL_FIELDS: Array<{ name: string; label: string; placeholder?: string; suggestions?: readonly string[]; description?: string }> = [
  { name: 'command', label: 'Command', placeholder: 'echo' },
  { name: 'arg1', label: 'Argument 1' },
  { name: 'arg2', label: 'Argument 2' },
  { name: 'arg3', label: 'Argument 3' },
  { name: 'arg4', label: 'Argument 4' },
  { name: 'arg5', label: 'Argument 5' },
  { name: 'directory', label: 'Working directory' },
  { name: 'wait', label: 'Wait for the command', suggestions: BOOLEAN_SUGGESTIONS, description: 'false does not wait: the output and exit code variables are not written.' },
  { name: 'redirectError', label: 'Redirect standard error', suggestions: BOOLEAN_SUGGESTIONS, description: 'true merges standard error into the output; otherwise it is discarded.' },
  { name: 'cleanEnv', label: 'Clean environment', suggestions: BOOLEAN_SUGGESTIONS },
  { name: 'outputVariable', label: 'Output variable' },
  { name: 'errorCodeVariable', label: 'Exit code variable' },
];

/** Names of the fields whose text is a variable name or a plain literal rather than an expression. */
const LITERAL_FIELDS = new Set(['textVar', 'htmlVar', 'charset', 'exceptionVariableName', 'ignoreException', 'outputVariable', 'errorCodeVariable', 'wait', 'redirectError', 'cleanEnv', 'directory', 'command']);

export function mailShellGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  const out: Array<Definition | undefined> = [];
  const make = (kind: 'mail' | 'shell', specs: typeof MAIL_FIELDS): Definition[] =>
    specs.map((s) =>
      b.fieldValue({
        key: `${kind}.${s.name}`,
        label: s.label,
        help: kind,
        placeholder: s.placeholder,
        suggestions: s.suggestions,
        description: s.description,
        defaultMode: LITERAL_FIELDS.has(s.name) ? 'string' : 'expression',
      }),
    );
  if (env.has(element, 'mail.to')) out.push(group({ id: 'mail', label: 'Mail fields', entries: make('mail', MAIL_FIELDS), shouldOpen: true }));
  if (env.has(element, 'shell.command')) out.push(group({ id: 'shell', label: 'Shell fields', entries: make('shell', SHELL_FIELDS), shouldOpen: true }));
  return out;
}

// --- script ------------------------------------------------------------------------------------------------------------------------------

const SCRIPT_FORMATS = [
  { value: '', label: 'JUEL (default)' },
  { value: 'juel', label: 'JUEL' },
  { value: 'javascript', label: 'JavaScript' },
];

export function scriptGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'script.format')) return [];
  const format = (env.get<string | undefined>(element, 'script.format') ?? '').toLowerCase();
  const isJuel = format === '' || format === 'juel';
  const entries: Definition[] = [
    b.select({ key: 'script.format', label: 'Script format', options: SCRIPT_FORMATS }),
    isJuel
      ? b.juel({ key: 'script.text', label: 'Script', mode: 'expression', rows: 4, placeholder: '${price * quantity}', description: 'A JUEL script is an expression; its value goes to the result variable.' })
      : b.juel({ key: 'script.text', label: 'Script', language: 'plain', mode: 'block', rows: 8, description: 'Statements; the value of the last expression goes to the result variable. Variables are visible by name; write with execution.setVariable(name, value).' }),
    b.text({ key: 'script.resultVariable', label: 'Result variable', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
    b.check({ key: 'script.autoStoreVariables', label: 'Auto-store variables' }),
  ];
  if (env.get<boolean>(element, 'script.autoStoreVariables')) {
    entries.push(b.info('script.autoStoreVariables.hint', 'Auto-store has no effect with the bundled script engines: JavaScript assignments never reach the process, and JUEL cannot assign. Use execution.setVariable(...).', 'warning', 'script.autoStoreVariables'));
  }
  if (!['', 'juel', 'javascript', 'js', 'ecmascript', 'nashorn'].includes(format)) {
    entries.push(b.info('script.format.hint', `The script format "${format}" needs a JSR-223 engine on the classpath; the engine bundles only JUEL and JavaScript.`, 'warning', 'script.format'));
  }
  entries.push(b.info('script.beans.hint', 'Scripts see the process variables, the execution and the Spring beans. A BpmnError thrown by a script reaches error boundary events of the task.', 'info', 'script.text'));
  return [group({ id: 'script', label: 'Script', entries, shouldOpen: true })];
}

// --- called element -----------------------------------------------------------------------------------------------------------------------

const PARAMETER_COLUMNS = (outbound: boolean): RowColumn[] => [
  { key: 'kind', kind: 'select', label: outbound ? 'Take from the child' : 'Take from the caller', options: [{ value: 'source', label: 'Variable' }, { value: 'sourceExpression', label: 'Expression' }] },
  { key: 'value', kind: 'text', label: 'Variable or expression', placeholder: outbound ? 'result or ${total * 2}' : 'customerId', validate: (v, r) => (r['kind'] === 'sourceExpression' ? expressionDiagnostic(v) : v ? variableNameProblem(v) : undefined) },
  { key: 'target', kind: 'text', label: outbound ? 'Target variable in the caller' : 'Target variable in the child', validate: (v) => (v ? variableNameProblem(v) : undefined) },
];

const parameterRow = (p: CallParameter): Row => ({ kind: p.sourceExpression !== undefined ? 'sourceExpression' : 'source', value: p.sourceExpression ?? p.source ?? '', target: p.target });
const parameterFromRow = (r: Row): CallParameter => (r['kind'] === 'sourceExpression' ? { sourceExpression: String(r['value']), target: String(r['target']) } : { source: String(r['value']), target: String(r['target']) });

export function calledElementGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'call.calledElement')) return [];
  const parameters = (key: 'call.in' | 'call.out', label: string, outbound: boolean): Definition =>
    b.rows<CallParameter>({
      key,
      label,
      addLabel: outbound ? 'Add out parameter' : 'Add in parameter',
      columns: PARAMETER_COLUMNS(outbound),
      toRow: parameterRow,
      fromRow: parameterFromRow,
      blank: () => ({ kind: 'source', value: '', target: '' }),
      missing: (r) => (!r['target'] ? 'A parameter needs a target' : !r['value'] ? 'It needs a source variable or expression' : undefined),
      rowTitle: (r) => String(r['target'] ?? ''),
    });
  const entries: Definition[] = [
    b.juel({ key: 'call.calledElement', label: 'Called element', placeholder: 'riskCheck or ${processKey}', validate: processKeyDiagnostic, description: 'The process key of the child, or an expression that gives it.' }),
    b.juel({ key: 'call.businessKey', label: 'Business key', placeholder: '${orderId}' }),
    b.check({ key: 'call.inheritBusinessKey', label: 'Inherit business key' }),
    b.check({ key: 'call.inheritVariables', label: 'Inherit variables' }),
    parameters('call.in', 'In parameters', false),
    parameters('call.out', 'Out parameters', true),
  ];
  if ((env.get<CallParameter[]>(element, 'call.out') ?? []).length > 0 && env.get<string>(element, 'mi.type') !== 'none') {
    entries.push(b.info('call.out.mi.hint', 'A multi-instance call activity gets nothing back from its children: out parameters and output mappings are skipped.', 'warning', 'call.out'));
  }
  return [group({ id: 'calledElement', label: 'Called element', entries, shouldOpen: true })];
}
