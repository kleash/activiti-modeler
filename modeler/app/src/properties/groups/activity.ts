import type { MapExceptionValue, MultiInstanceType } from '@activiti-modeler/bpmn-js-activiti';

import { group, type Definition, type EntryBuilder } from '../builders';
import type { RowColumn } from '../components/RowsEntry';
import { variableNameProblem } from '../validation/ids';
import { exceptionClassDiagnostic, expressionDiagnostic, retryCycleDiagnostic } from '../validation/values';

const SKIP_VARIABLE = '_ACTIVITI_SKIP_EXPRESSION_ENABLED';

/** A variable name, or (for a collection) an expression. */
const nameOrExpression = (value: string | undefined) => (value && /[$#]\{/.test(value) ? expressionDiagnostic(value) : value ? variableNameProblem(value) : undefined);

export function multiInstanceGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'mi.type')) return [];
  const type = env.get<MultiInstanceType>(element, 'mi.type');
  const entries: Definition[] = [
    b.select({
      key: 'mi.type',
      label: 'Multi-instance',
      options: [{ value: 'none', label: 'None' }, { value: 'parallel', label: 'Parallel' }, { value: 'sequential', label: 'Sequential' }],
      read: (raw) => String(raw ?? 'none'),
      write: (text) => text ?? 'none',
    }),
  ];
  if (type !== 'none') {
    const isCall = element.type === 'bpmn:CallActivity';
    entries.push(
      b.juel({ key: 'mi.cardinality', label: 'Loop cardinality', placeholder: '3 or ${count}', description: 'How many instances. Use this or a collection.' }),
      b.text({ key: 'mi.collection', label: 'Collection', placeholder: 'reviewers or ${approvers}', validate: nameOrExpression }),
      b.text({ key: 'mi.elementVariable', label: 'Element variable', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
      b.text({ key: 'mi.elementIndexVariable', label: 'Element index variable', placeholder: 'loopCounter', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
      b.juel({ key: 'mi.completionCondition', label: 'Completion condition', mode: 'condition', placeholder: '${nrOfCompletedInstances >= quorum}' }),
    );
    if (!isCall) {
      entries.push(
        b.text({ key: 'mi.outputCollection', label: 'Output collection', placeholder: 'verdicts', description: 'The variable that collects the output element of every instance.', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
        b.text({ key: 'mi.outputItem', label: 'Output element', placeholder: 'verdict', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
      );
    } else {
      entries.push(b.info('mi.call.hint', 'A multi-instance call activity gets nothing back from its children (out parameters, output mappings and output collections are skipped).', 'warning', 'mi.type'));
    }
    const cardinality = env.get<string | undefined>(element, 'mi.cardinality');
    const collection = env.get<string | undefined>(element, 'mi.collection');
    if (cardinality && collection) entries.push(b.info('mi.both.hint', 'A loop cardinality and a collection are both set: the engine uses the cardinality.', 'warning', 'mi.cardinality'));
  }
  return [group({ id: 'multiInstance', label: 'Multi-instance', entries })];
}

export function asyncGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'async.async')) return [];
  return [
    group({
      id: 'async',
      label: 'Asynchronous continuation',
      entries: [
        b.check({ key: 'async.async', label: 'Asynchronous', description: 'Run the activity in its own transaction, through a job.' }),
        b.check({ key: 'async.exclusive', label: 'Exclusive', description: 'Exclusive jobs of one process instance never run at the same time.' }),
      ],
    }),
  ];
}

export function jobGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'job.failedJobRetryTimeCycle')) return [];
  return [
    group({
      id: 'job',
      label: 'Job execution',
      entries: [b.text({ key: 'job.failedJobRetryTimeCycle', label: 'Failed job retry time cycle', placeholder: 'R5/PT10S', validate: retryCycleDiagnostic, description: 'The number of attempts and the wait between them. Without a cycle a job gets 3 attempts.' })],
    }),
  ];
}

const MAP_EXCEPTION_COLUMNS: RowColumn[] = [
  { key: 'errorCode', kind: 'text', label: 'Error code', placeholder: 'PAYMENT_FAILED' },
  { key: 'exceptionClass', kind: 'text', label: 'Exception class', placeholder: 'com.example.PaymentException', validate: exceptionClassDiagnostic },
  { key: 'includeChildExceptions', kind: 'check', label: 'Include subclasses of the exception' },
];

export function errorMappingGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'errors.mapExceptions')) return [];
  return [
    group({
      id: 'errorMapping',
      label: 'Error mapping',
      entries: [
        b.rows<MapExceptionValue>({
          key: 'errors.mapExceptions',
          label: 'Exception mappings',
          addLabel: 'Add mapping',
          columns: MAP_EXCEPTION_COLUMNS,
          toRow: (m) => ({ errorCode: m.errorCode, exceptionClass: m.exceptionClass, includeChildExceptions: m.includeChildExceptions === true }),
          fromRow: (r) => ({ errorCode: String(r['errorCode']), exceptionClass: String(r['exceptionClass']), includeChildExceptions: r['includeChildExceptions'] === true }),
          blank: () => ({ errorCode: '', exceptionClass: '', includeChildExceptions: false }),
          missing: (r) => (!r['errorCode'] ? 'A mapping needs an error code' : undefined),
          rowTitle: (r) => String(r['errorCode'] ?? ''),
          reorder: true,
          description: 'The first matching mapping wins. A mapping without an exception class is the default for every other exception: put it last. An error boundary event with the error code catches the error.',
        }),
      ],
    }),
  ];
}

export function skipGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'skip.expression')) return [];
  const entries: Definition[] = [b.juel({ key: 'skip.expression', label: 'Skip expression', mode: 'condition', placeholder: '${skipReview}' })];
  const expression = env.get<string | undefined>(element, 'skip.expression');
  const enabled = env.variables(element).some((v) => v.name === SKIP_VARIABLE);
  if (expression && !enabled) {
    entries.push(b.info('skip.enabled.hint', `The skip expression is ignored unless the process variable ${SKIP_VARIABLE} is true. Declare it as a process property with the default true (it cannot be a start variable).`, 'warning', 'skip.expression'));
  } else {
    entries.push(b.info('skip.enabled.hint', `A true skip expression skips the element only while ${SKIP_VARIABLE} is true. A skipped user task is still created and deleted, with its listeners.`, 'info', 'skip.expression'));
  }
  return [group({ id: 'skip', label: 'Skip expression', entries })];
}

export function conditionGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, 'flow.condition')) return [];
  const entries: Definition[] = [];
  const isDefault = env.has(element, 'flow.default') && env.get<boolean>(element, 'flow.default');
  if (!isDefault) {
    entries.push(b.juel({ key: 'flow.condition', label: 'Condition expression', mode: 'condition', placeholder: '${amount > 100}' }));
  } else {
    entries.push(b.info('flow.condition.hint', 'The default flow is taken when no other condition is true; it has no condition.', 'info', 'flow.default'));
  }
  if (env.has(element, 'flow.default')) entries.push(b.check({ key: 'flow.default', label: 'Default flow' }));
  if (element.source && element.source.type === 'bpmn:ParallelGateway') {
    entries.push(b.info('flow.condition.parallel', 'A parallel gateway ignores conditions: every outgoing flow is taken.', 'warning', 'flow.condition'));
  } else if (element.source && !element.source.type.endsWith('Gateway') && !isDefault) {
    entries.push(b.info('flow.condition.implicit', 'A condition on a flow that leaves a task is an implicit split: the flow is taken only when the condition is true.', 'info', 'flow.condition'));
  }
  return [group({ id: 'condition', label: 'Condition', entries, shouldOpen: true })];
}
