import type { DataObjectInput, DefinitionsUsage, ErrorInput, MessageInput, SignalInput } from '@activiti-modeler/bpmn-js-activiti';
import { DATA_TYPES } from '@activiti-modeler/bpmn-js-activiti';

import { EntryBuilder, group, type Definition } from '../builders';
import { idProblem, variableNameProblem } from '../validation/ids';
import { error } from '../validation/types';
import { listGroup, uniqueName } from './lists';

const PROCESS_DOCUMENTATION_LIMIT = 2000;

/** General, Documentation and Candidate starters. */
export function generalGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  const groups: Array<Definition | undefined> = [];

  const general: Definition[] = [];
  if (env.has(element, 'general.name')) general.push(b.text({ key: 'general.name', label: 'Name' }));
  if (env.has(element, 'general.id')) {
    general.push(b.text({ key: 'general.id', label: 'ID', validate: (v) => idProblem(v ?? '') }));
  }
  if (env.has(element, 'general.executable')) {
    general.push(b.check({ key: 'general.executable', label: 'Executable', disabled: true, description: 'Activiti runs only executable processes, so the modeler keeps this on.' }));
  }
  if (env.has(element, 'general.targetNamespace')) {
    general.push(
      b.text({
        key: 'general.targetNamespace',
        label: 'Target namespace',
        validate: (v) => ((v ?? '').length > 255 ? error('The target namespace has at most 255 characters.') : undefined),
      }),
    );
  }
  groups.push(group({ id: 'general', label: 'General', entries: general, shouldOpen: true }));

  const documentation: Definition[] = [];
  if (env.has(element, 'documentation.text')) {
    const isProcess = element.type === 'bpmn:Process';
    const length = (env.get<string | undefined>(element, 'documentation.text') ?? '').length;
    documentation.push(
      b.area({
        key: 'documentation.text',
        label: 'Element documentation',
        rows: 3,
        ...(isProcess ? { description: `${length} of ${PROCESS_DOCUMENTATION_LIMIT} characters` } : {}),
        validate: (v) => (isProcess && (v ?? '').length > PROCESS_DOCUMENTATION_LIMIT ? error(`The documentation of a process becomes its description and has at most ${PROCESS_DOCUMENTATION_LIMIT} characters (this has ${(v ?? '').length}).`) : undefined),
      }),
    );
  }
  groups.push(group({ id: 'documentation', label: 'Documentation', entries: documentation }));

  const starters: Definition[] = [];
  if (env.has(element, 'starters.users')) starters.push(b.text({ key: 'starters.users', label: 'Candidate starter users', placeholder: 'ann, bob' }));
  if (env.has(element, 'starters.groups')) starters.push(b.text({ key: 'starters.groups', label: 'Candidate starter groups', placeholder: 'clerks' }));
  if (env.has(element, 'starters.potential')) starters.push(b.text({ key: 'starters.potential', label: 'Potential starter expression', placeholder: 'user(ann), group(clerks)' }));
  groups.push(group({ id: 'starters', label: 'Candidate starters', entries: starters }));
  return groups;
}

// --- messages, signals, errors ------------------------------------------------------------------------------------------------

type Kind = 'messages' | 'signals' | 'errors';
const KEY = { messages: 'definitions.messages', signals: 'definitions.signals', errors: 'definitions.errors' } as const;

const usedBy = (n: number): string => (n === 0 ? 'Not used by any event or task.' : `Used by ${n} ${n === 1 ? 'element' : 'elements'}; deleting it clears ${n === 1 ? 'that reference' : 'those references'} (one undo step).`);

/** The lists of messages, signals and errors of the file: create, rename, delete with the number of references, signal scope, error code. */
export function definitionGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  if (!env.has(element, KEY.messages)) return [];
  const usage = env.get<DefinitionsUsage>(element, 'definitions.usage');
  const out: Definition[] = [];

  const write = (kind: Kind, list: unknown[], entryId: string): void => void env.write(element, KEY[kind], list, entryId);

  // messages
  const messages = env.get<MessageInput[]>(element, KEY.messages);
  out.push(
    listGroup({
      id: 'messages',
      label: 'Messages',
      add: () => write('messages', [...messages, { name: uniqueName('newMessage', messages.map((m) => m.name)) }], 'definitions.messages'),
      items: messages.map((m, i) => {
        const base = `definitions.messages[${i}]`;
        const replace = (patch: Partial<MessageInput>): unknown[] => messages.map((x, j) => (j === i ? { ...x, ...patch } : x));
        return {
          id: base,
          label: m.name || m.id || 'Message',
          remove: () => write('messages', messages.filter((_, j) => j !== i), base),
          entries: [
            b.textRaw({ id: `${base}.name`, label: 'Name', help: 'messages', value: m.name, commit: (v) => write('messages', replace({ name: v ?? '' }), `${base}.name`), validate: (v) => (v ? undefined : error('A message needs a name.')) }),
            b.textRaw({ id: `${base}.id`, label: 'ID', help: 'general.id', value: m.id, commit: (v) => write('messages', replace({ id: v ?? '' }), `${base}.id`), validate: (v) => idProblem(v ?? '') }),
            b.info(`${base}.usage`, usedBy(usage.messages[m.id as string] ?? 0), 'info'),
          ],
        };
      }),
    }),
  );

  // signals
  const signals = env.get<SignalInput[]>(element, KEY.signals);
  out.push(
    listGroup({
      id: 'signals',
      label: 'Signals',
      add: () => write('signals', [...signals, { name: uniqueName('newSignal', signals.map((s) => s.name)) }], 'definitions.signals'),
      items: signals.map((s, i) => {
        const base = `definitions.signals[${i}]`;
        const replace = (patch: Partial<SignalInput>): unknown[] => signals.map((x, j) => (j === i ? { ...x, ...patch } : x));
        return {
          id: base,
          label: s.name || s.id || 'Signal',
          remove: () => write('signals', signals.filter((_, j) => j !== i), base),
          entries: [
            b.textRaw({ id: `${base}.name`, label: 'Name', help: 'signals', value: s.name, commit: (v) => write('signals', replace({ name: v ?? '' }), `${base}.name`), validate: (v) => (v ? undefined : error('A signal needs a name.')) }),
            b.textRaw({ id: `${base}.id`, label: 'ID', help: 'general.id', value: s.id, commit: (v) => write('signals', replace({ id: v ?? '' }), `${base}.id`), validate: (v) => idProblem(v ?? '') }),
            b.selectRaw({
              id: `${base}.scope`,
              label: 'Scope',
              help: 'signal.scope',
              value: s.scope,
              options: [{ value: '', label: 'Default (global)' }, { value: 'global', label: 'Global: every process instance' }, { value: 'processInstance', label: 'Process instance: only the throwing instance' }],
              commit: (v) => write('signals', replace(v === undefined ? { scope: undefined } : { scope: v as SignalInput['scope'] }), `${base}.scope`),
            }),
            b.info(`${base}.usage`, usedBy(usage.signals[s.id as string] ?? 0), 'info'),
          ],
        };
      }),
    }),
  );

  // errors
  const errors = env.get<ErrorInput[]>(element, KEY.errors);
  out.push(
    listGroup({
      id: 'errors',
      label: 'Errors',
      add: () => write('errors', [...errors, { errorCode: uniqueName('ERROR_CODE', errors.map((e) => e.errorCode)) }], 'definitions.errors'),
      items: errors.map((e, i) => {
        const base = `definitions.errors[${i}]`;
        const replace = (patch: Partial<ErrorInput>): unknown[] => errors.map((x, j) => (j === i ? { ...x, ...patch } : x));
        return {
          id: base,
          label: e.errorCode || e.name || e.id || 'Error',
          remove: () => write('errors', errors.filter((_, j) => j !== i), base),
          entries: [
            b.textRaw({ id: `${base}.errorCode`, label: 'Error code', help: 'error.ref', value: e.errorCode, commit: (v) => write('errors', replace({ errorCode: v ?? '' }), `${base}.errorCode`), validate: (v) => (v ? undefined : error('An error needs an error code.')) }),
            b.textRaw({ id: `${base}.name`, label: 'Name', help: 'errors', value: e.name, commit: (v) => write('errors', replace(v === undefined ? { name: undefined } : { name: v }), `${base}.name`) }),
            b.textRaw({ id: `${base}.id`, label: 'ID', help: 'general.id', value: e.id, commit: (v) => write('errors', replace({ id: v ?? '' }), `${base}.id`), validate: (v) => idProblem(v ?? '') }),
            b.info(`${base}.usage`, usedBy(usage.errors[e.id as string] ?? 0), 'info'),
          ],
        };
      }),
    }),
  );
  return out;
}

// --- data objects -----------------------------------------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  'xsd:string': 'Text (xsd:string)',
  'xsd:int': 'Integer (xsd:int)',
  'xsd:long': 'Long (xsd:long)',
  'xsd:double': 'Decimal (xsd:double)',
  'xsd:boolean': 'Boolean (xsd:boolean)',
  'xsd:datetime': 'Date and time (xsd:datetime)',
};
const TYPE_OPTIONS = [{ value: '', label: 'Text (no type)' }, ...DATA_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] ?? t }))];

/**
 * Data objects: the typed variables a process or sub process creates when it starts. They are edited as a list of the container
 * (they have no shape, Activiti 9 reports the diagram shape of a data object as an invalid reference); a drawn data object
 * reference is edited through the same fields.
 */
export function dataObjectGroups(b: EntryBuilder): Array<Definition | undefined> {
  const { env, element } = b;
  const out: Array<Definition | undefined> = [];
  if (env.has(element, 'data.objects')) {
    const objects = env.get<DataObjectInput[]>(element, 'data.objects');
    const write = (list: DataObjectInput[], entryId: string): void => void env.write(element, 'data.objects', list, entryId);
    out.push(
      listGroup({
        id: 'dataObjects',
        label: 'Data objects',
        add: () => write([...objects, { name: uniqueName('variable', objects.map((o) => o.name)), type: 'xsd:string' }], 'data.objects'),
        items: objects.map((o, i) => {
          const base = `data.objects[${i}]`;
          const replace = (patch: Partial<DataObjectInput>): DataObjectInput[] => objects.map((x, j) => (j === i ? { ...x, ...patch } : x));
          return {
            id: base,
            label: o.name || o.id || 'Data object',
            remove: () => write(objects.filter((_, j) => j !== i), base),
            entries: [
              b.textRaw({ id: `${base}.name`, label: 'Name (the variable)', help: 'data.name', value: o.name, commit: (v) => write(replace({ name: v ?? '' }), `${base}.name`), validate: (v) => (v ? variableNameProblem(v) : error('A data object needs a name.')) }),
              b.textRaw({ id: `${base}.id`, label: 'ID', help: 'general.id', value: o.id, commit: (v) => write(replace({ id: v ?? '' }), `${base}.id`), validate: (v) => idProblem(v ?? '') }),
              b.selectRaw({ id: `${base}.type`, label: 'Type', help: 'data.type', value: o.type ?? '', options: TYPE_OPTIONS, commit: (v) => write(replace(v === undefined ? { type: undefined } : { type: v }), `${base}.type`) }),
              b.textRaw({ id: `${base}.value`, label: 'Default value', help: 'data.value', value: o.value, commit: (v) => write(replace(v === undefined ? { value: undefined } : { value: v }), `${base}.value`) }),
            ],
          };
        }),
      }),
    );
  }
  if (env.has(element, 'data.type')) {
    out.push(
      group({
        id: 'dataObject',
        label: 'Data object',
        entries: [
          b.text({ key: 'data.name', label: 'Name (the variable)', validate: (v) => (v ? variableNameProblem(v) : undefined) }),
          b.text({ key: 'data.id', label: 'Data object ID', validate: (v) => idProblem(v ?? '') }),
          b.select({ key: 'data.type', label: 'Type', options: TYPE_OPTIONS }),
          b.text({ key: 'data.value', label: 'Default value' }),
        ],
      }),
    );
  }
  return out;
}
