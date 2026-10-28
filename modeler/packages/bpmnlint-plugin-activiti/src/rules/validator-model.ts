/**
 * Mirrors of the ProcessValidator keys about the model as a whole: processes, ids, signals, messages, errors, data, diagram
 * references. Severity and key are those of Activiti 9.0.0 (`org.activiti.validation.validator.Problems`).
 */
import { defineRule, onDefinitions, onTypes } from '../define';
import { bool, child, is, isBlank, list, processesOf, rootElementByQName, rootElements, str } from '../model';
import type { ME } from '../types';

const R1_7 = 'R1 §7 (ProcessValidator keys)';

const documentationText = (process: ME): string => list(process, 'documentation').map((d) => (typeof d['text'] === 'string' ? d['text'] : '')).join('');
const anyExecutable = (definitions: ME): boolean => processesOf(definitions).some((p) => bool(p, 'isExecutable') !== false);
const isExecutable = (process: ME): boolean => bool(process, 'isExecutable') !== false;

export const modelRules = [
  defineRule({
    id: 'all-process-definitions-not-executable',
    tag: 'V',
    key: 'ALL_PROCESS_DEFINITIONS_NOT_EXECUTABLE',
    severity: 'error',
    title: 'No process of the file is executable',
    why: 'Activiti skips a process with `isExecutable="false"` without a message and refuses a file in which every process is skipped. bpmn-js writes `false` for new diagrams, so a foreign file usually has it.',
    evidence: [R1_7, 'R1 §2.1-5'],
    howToFix: 'Set **Executable** on the process (the modeler forces it for its own diagrams).',
    quickFix: 'set-executable',
    entry: 'general.executable',
    serverKeys: ['ALL_PROCESS_DEFINITIONS_NOT_EXECUTABLE'],
    check: onDefinitions((definitions, api) => {
      const processes = processesOf(definitions);
      if (processes.length > 0 && !anyExecutable(definitions)) api.report(processes[0]!, 'None of the processes in this file is executable (isExecutable="false"): Activiti skips them all');
    }),
    bad: [{ process: 'isExecutable="false"', ids: ['p'] }],
    good: [{ body: '' }, { process: 'name="No attribute"' }],
  }),
  defineRule({
    id: 'process-definition-not-executable',
    tag: 'V',
    key: 'PROCESS_DEFINITION_NOT_EXECUTABLE',
    severity: 'warn',
    title: 'A process is not executable while another one in the file is',
    why: 'Activiti deploys the executable processes and ignores the others, so this process never runs (L15).',
    evidence: [R1_7, 'R1 §7.1 L15'],
    howToFix: 'Set **Executable** on the process, or move it to a file of its own if it is documentation only.',
    quickFix: 'set-executable',
    entry: 'general.executable',
    serverKeys: ['PROCESS_DEFINITION_NOT_EXECUTABLE'],
    check: onTypes('bpmn:Process', (process, api) => {
      if (!isExecutable(process) && api.definitions && anyExecutable(api.definitions)) api.report(process, `Process ${process.id} is not executable and is ignored by Activiti`);
    }),
    bad: [{ process: 'isExecutable="false"', tail: '<process id="q" isExecutable="true"/>', ids: ['p'] }],
    good: [{ tail: '<process id="q" isExecutable="true"/>' }],
  }),
  defineRule({
    id: 'process-definition-id-not-unique',
    tag: 'V',
    key: 'PROCESS_DEFINITION_ID_NOT_UNIQUE',
    severity: 'error',
    title: 'Two processes in the file have the same id',
    why: 'The process id is the process definition key. Activiti only detects a duplicate among processes that have a name.',
    evidence: [R1_7],
    howToFix: 'Give every process its own id (**General > ID**).',
    entry: 'general.id',
    serverKeys: ['PROCESS_DEFINITION_ID_NOT_UNIQUE'],
    check: onDefinitions((definitions, api) => {
      // bpmn-moddle keeps the first element of an id and drops the later ones; the drop is what tells us
      for (const dropped of api.ctx.duplicateIds ?? []) {
        if (dropped.tag !== 'process') continue;
        const kept = processesOf(definitions).find((p) => p.id === dropped.id);
        if (kept && !isBlank(str(kept, 'name'))) api.report(kept, `Another process in this file also has the id "${dropped.id}"`);
      }
    }),
    needs: ['text'],
    bad: [{ process: 'name="A" isExecutable="true"', tail: '<process id="p" name="B" isExecutable="true"/>', ids: ['p'] }],
    good: [{ tail: '<process id="q" name="B" isExecutable="true"/>' }],
  }),
  ...(
    [
      ['process-definition-id-too-long', 'PROCESS_DEFINITION_ID_TOO_LONG', 'The process id is longer than 255 characters', (p: ME) => (p.id ?? '').length > 255, 'id of a process is limited to 255 characters (the definition key column)', 'general.id'],
      ['process-definition-name-too-long', 'PROCESS_DEFINITION_NAME_TOO_LONG', 'The process name is longer than 255 characters', (p: ME) => (str(p, 'name') ?? '').length > 255, 'the process name is limited to 255 characters', 'general.name'],
      ['process-definition-documentation-too-long', 'PROCESS_DEFINITION_DOCUMENTATION_TOO_LONG', 'The process documentation is longer than 2000 characters', (p: ME) => documentationText(p).length > 2000, 'the process documentation becomes the definition description, limited to 2000 characters', 'documentation.text'],
    ] as const
  ).map(([id, key, title, test, reason, entry]) =>
    defineRule({
      id,
      tag: 'V',
      key,
      severity: 'error',
      title,
      why: `Activiti rejects the deployment: ${reason}. Only evaluated when the file has an executable process.`,
      evidence: [R1_7],
      howToFix: 'Shorten the value.',
      entry,
      serverKeys: [key],
      check: onTypes('bpmn:Process', (process, api) => {
        if (api.definitions && anyExecutable(api.definitions) && test(process)) api.report(process, title);
      }),
      bad: [
        id === 'process-definition-id-too-long'
          ? { xml: `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="urn:t"><process id="${'p'.repeat(256)}" isExecutable="true"/></definitions>`, ids: ['p'.repeat(256)] }
          : id === 'process-definition-name-too-long'
            ? { process: `isExecutable="true" name="${'n'.repeat(256)}"`, ids: ['p'] }
            : { body: `<documentation>${'x'.repeat(2001)}</documentation>`, ids: ['p'] },
      ],
      good: [id === 'process-definition-id-too-long' ? { body: '' } : id === 'process-definition-name-too-long' ? { process: `isExecutable="true" name="${'n'.repeat(255)}"` } : { body: `<documentation>${'x'.repeat(2000)}</documentation>` }],
    }),
  ),
  defineRule({
    id: 'bpmn-model-target-namespace-too-long',
    tag: 'V',
    key: 'BPMN_MODEL_TARGET_NAMESPACE_TOO_LONG',
    severity: 'error',
    title: 'The targetNamespace of the definitions is longer than 255 characters',
    why: 'The target namespace becomes the process definition category, limited to 255 characters.',
    evidence: [R1_7],
    howToFix: 'Shorten **Target namespace** on the definitions.',
    entry: 'general.targetNamespace',
    serverKeys: ['BPMN_MODEL_TARGET_NAMESPACE_TOO_LONG'],
    check: onDefinitions((definitions, api) => {
      if (anyExecutable(definitions) && (str(definitions, 'targetNamespace') ?? '').length > 255) api.report(definitions, 'The target namespace is longer than 255 characters');
    }),
    bad: [{ defs: `targetNamespace="urn:${'n'.repeat(260)}"`, ids: ['d'] }],
    good: [{ body: '' }],
  }),
  defineRule({
    id: 'flow-element-id-too-long',
    tag: 'V',
    key: 'FLOW_ELEMENT_ID_TOO_LONG',
    severity: 'error',
    title: 'The id of an activity is longer than 255 characters',
    why: 'Activiti checks the id of tasks and call activities (not of events, gateways or sub processes) against the 255 character column limit.',
    evidence: [R1_7],
    howToFix: 'Shorten the **ID** of the element.',
    entry: 'general.id',
    serverKeys: ['FLOW_ELEMENT_ID_TOO_LONG'],
    check: onTypes('bpmn:Activity', (activity, api) => {
      if (!is(activity, 'bpmn:SubProcess') && (activity.id ?? '').length > 255) api.report(activity, `The id of ${activity.id!.slice(0, 20)}... has ${activity.id!.length} characters, the limit is 255`);
    }),
    bad: [{ body: `<task id="${'t'.repeat(256)}"/>`, ids: ['t'.repeat(256)] }],
    good: [{ body: `<task id="${'t'.repeat(255)}"/>` }],
  }),
  defineRule({
    id: 'association-invalid-source-reference',
    tag: 'V',
    key: 'ASSOCIATION_INVALID_SOURCE_REFERENCE',
    severity: 'error',
    title: 'An association has no source',
    why: 'Associations attach compensation handlers and annotations; Activiti rejects one without `sourceRef`.',
    evidence: [R1_7],
    howToFix: 'Reconnect the association to an element, or delete it.',
    quickFix: 'remove-element',
    serverKeys: ['ASSOCIATION_INVALID_SOURCE_REFERENCE'],
    check: onTypes('bpmn:Association', (association, api) => {
      if (!association.get('sourceRef')) api.report(association, `Association ${association.id} has no source element`);
    }),
    bad: [{ body: '<task id="t"/><association id="a" targetRef="t"/>', ids: ['a'] }],
    good: [{ body: '<task id="t"/><association id="a" sourceRef="t" targetRef="t"/>' }],
  }),
  defineRule({
    id: 'association-invalid-target-reference',
    tag: 'V',
    key: 'ASSOCIATION_INVALID_TARGET_REFERENCE',
    severity: 'error',
    title: 'An association has no target',
    why: 'Activiti rejects an association without `targetRef`.',
    evidence: [R1_7],
    howToFix: 'Reconnect the association to an element, or delete it.',
    quickFix: 'remove-element',
    serverKeys: ['ASSOCIATION_INVALID_TARGET_REFERENCE'],
    check: onTypes('bpmn:Association', (association, api) => {
      if (!association.get('targetRef')) api.report(association, `Association ${association.id} has no target element`);
    }),
    bad: [{ body: '<task id="t"/><association id="a" sourceRef="t"/>', ids: ['a'] }],
    good: [{ body: '<task id="t"/><association id="a" sourceRef="t" targetRef="t"/>' }],
  }),
  defineRule({
    id: 'signal-missing-id',
    tag: 'V',
    key: 'SIGNAL_MISSING_ID',
    severity: 'error',
    title: 'A signal definition has no id',
    why: 'Events refer to a signal by its id.',
    evidence: [R1_7],
    howToFix: 'Give the signal an id (the Signals list of the process does).',
    entry: 'definitions.signals',
    serverKeys: ['SIGNAL_MISSING_ID'],
    check: onTypes('bpmn:Signal', (signal, api) => {
      if (isBlank(signal.id)) api.report(signal, `Signal "${str(signal, 'name') ?? ''}" has no id`);
    }),
    bad: [{ head: '<signal name="go"/>', ids: ['d'] }],
    good: [{ head: '<signal id="s" name="go"/>' }],
  }),
  defineRule({
    id: 'signal-missing-name',
    tag: 'V',
    key: 'SIGNAL_MISSING_NAME',
    severity: 'error',
    title: 'A signal definition has no name',
    why: 'The signal name is what is thrown and caught; without it the signal is unusable.',
    evidence: [R1_7],
    howToFix: 'Give the signal a name in the Signals list.',
    entry: 'definitions.signals',
    serverKeys: ['SIGNAL_MISSING_NAME'],
    check: onTypes('bpmn:Signal', (signal, api) => {
      if (isBlank(str(signal, 'name'))) api.report(signal, `Signal ${signal.id ?? ''} has no name`);
    }),
    bad: [{ head: '<signal id="s"/>', ids: ['s'] }],
    good: [{ head: '<signal id="s" name="go"/>' }],
  }),
  defineRule({
    id: 'signal-duplicate-name',
    tag: 'V',
    key: 'SIGNAL_DUPLICATE_NAME',
    severity: 'error',
    title: 'Two signal definitions have the same name',
    why: 'Signal names are unique per file; two definitions of one name make the reference ambiguous.',
    evidence: [R1_7],
    howToFix: 'Rename or delete one of the signals.',
    entry: 'definitions.signals',
    serverKeys: ['SIGNAL_DUPLICATE_NAME'],
    check: onTypes('bpmn:Signal', (signal, api) => {
      const name = str(signal, 'name');
      if (isBlank(name)) return;
      const others = rootElements(api.definitions).filter((r) => is(r, 'bpmn:Signal') && r !== signal && str(r, 'name') === name && r.id !== signal.id);
      if (others.length > 0) api.report(signal, `Signal name "${name}" is defined more than once`);
    }),
    bad: [{ head: '<signal id="s1" name="go"/><signal id="s2" name="go"/>', ids: ['s1', 's2'] }],
    good: [{ head: '<signal id="s1" name="go"/><signal id="s2" name="stop"/>' }],
  }),
  defineRule({
    id: 'signal-invalid-scope',
    tag: 'V',
    key: 'SIGNAL_INVALID_SCOPE',
    severity: 'error',
    title: 'A signal has a scope other than global or processInstance',
    why: '`activiti:scope` decides whether a thrown signal reaches every process instance or only the throwing one; other values are rejected.',
    evidence: [R1_7],
    howToFix: 'Choose **global** or **processInstance** in the Signals list.',
    entry: 'signal.scope',
    serverKeys: ['SIGNAL_INVALID_SCOPE'],
    check: onTypes('bpmn:Signal', (signal, api) => {
      const scope = str(signal, 'activiti:scope');
      if (scope !== undefined && scope !== 'global' && scope !== 'processInstance') api.report(signal, `Signal ${signal.id} has the scope "${scope}"; use global or processInstance`);
    }),
    bad: [{ head: '<signal id="s" name="go" activiti:scope="everywhere"/>', ids: ['s'] }],
    good: [{ head: '<signal id="s" name="go" activiti:scope="processInstance"/>' }],
  }),
  defineRule({
    id: 'operation-invalid-in-message-reference',
    tag: 'V',
    key: 'OPERATION_INVALID_IN_MESSAGE_REFERENCE',
    severity: 'error',
    title: 'An operation with an implementation refers to an input message that does not exist',
    why: 'Operations only matter for web service tasks, which Activiti 9 cannot run, but the validator still checks the `<inMessageRef>` child element of every operation. Only an operation that has an `implementationRef` is read at all (the parser drops the others), so only those are checked.',
    evidence: [R1_7, 'engine-findings V.1'],
    howToFix: 'Delete the interface or define the message it refers to.',
    serverKeys: ['OPERATION_INVALID_IN_MESSAGE_REFERENCE'],
    check: onTypes('bpmn:Operation', (operation, api) => {
      if (isBlank(str(operation, 'implementationRef'))) return; // InterfaceParser keeps an operation only when it has an implementationRef
      if (!rootElementByQName(operation, str(operation, 'inMessageRef'), 'bpmn:Message')) api.report(operation, `Operation ${operation.id ?? ''} refers to an input message that is not defined`);
    }),
    bad: [
      { head: '<interface id="i" name="I"><operation id="o" name="op" implementationRef="impl"><inMessageRef>nomsg</inMessageRef></operation></interface>', ids: ['o'] },
    ],
    good: [
      { head: '<message id="m" name="m"/><interface id="i" name="I"><operation id="o" name="op" implementationRef="impl"><inMessageRef>m</inMessageRef></operation></interface>' },
      { head: '<message id="m" name="m"/><interface id="i" name="I"><operation id="o" name="op" implementationRef="impl"><inMessageRef>tns:m</inMessageRef></operation></interface>', defs: 'xmlns:tns="urn:fixture"', note: 'a prefix bound to the target namespace names the same message' },
      { head: '<interface id="i" name="I"><operation id="o" name="op"><inMessageRef>nomsg</inMessageRef></operation></interface>', note: 'no implementationRef: the engine drops the operation and never validates it' },
    ],
  }),
  defineRule({
    id: 'error-missing-error-code',
    tag: 'V',
    key: 'ERROR_MISSING_ERROR_CODE',
    severity: 'error',
    title: 'An error definition has no errorCode',
    why: 'Error events are matched by error code; the validator rejects a definition without one.',
    evidence: [R1_7],
    howToFix: 'Give the error a code in the Errors list.',
    entry: 'definitions.errors',
    serverKeys: ['ERROR_MISSING_ERROR_CODE'],
    check: onTypes('bpmn:Error', (error, api) => {
      if (isBlank(str(error, 'errorCode'))) api.report(error, `Error ${error.id ?? ''} has no error code`);
    }),
    bad: [{ head: '<error id="e" name="oops"/>', ids: ['e'] }],
    good: [{ head: '<error id="e" name="oops" errorCode="E1"/>' }],
  }),
  defineRule({
    id: 'data-object-missing-name',
    tag: 'V',
    key: 'DATA_OBJECT_MISSING_NAME',
    severity: 'error',
    title: 'A data object has no name',
    why: 'A data object becomes a process variable named after it.',
    evidence: [R1_7],
    howToFix: 'Name the data object.',
    entry: 'data.name',
    serverKeys: ['DATA_OBJECT_MISSING_NAME'],
    check: onTypes('bpmn:DataObject', (dataObject, api) => {
      if (isBlank(str(dataObject, 'name'))) api.report(dataObject, `Data object ${dataObject.id} has no name`);
    }),
    bad: [{ body: '<dataObject id="d1"/>', ids: ['d1'] }],
    good: [{ body: '<dataObject id="d1" name="amount"/>' }],
  }),
  defineRule({
    id: 'message-invalid-item-ref',
    tag: 'V',
    key: 'MESSAGE_INVALID_ITEM_REF',
    severity: 'error',
    title: 'A message refers to an item definition that does not exist',
    why: 'The validator resolves `itemRef` among the item definitions of the file. The parser registers an item definition only when it has a `structureRef`, so one without it does not exist for the engine.',
    evidence: [R1_7, 'engine-findings V.2'],
    howToFix: 'Remove the item reference, or define the item (with a structureRef).',
    entry: 'definitions.messages',
    serverKeys: ['MESSAGE_INVALID_ITEM_REF'],
    check: onTypes('bpmn:Message', (message, api) => {
      const ref = str(message, 'itemRef');
      if (isBlank(ref)) return;
      const item = rootElementByQName(message, ref, 'bpmn:ItemDefinition');
      if (!item) api.report(message, `Message ${message.id} refers to the item definition "${ref}", which is not defined`);
      else if (isBlank(str(item, 'structureRef'))) api.report(message, `Message ${message.id} refers to the item definition "${item.id}", which has no structureRef; Activiti ignores an item definition without one`);
    }),
    bad: [
      { head: '<message id="m" name="m" itemRef="missing"/>', ids: ['m'] },
      { head: '<itemDefinition id="item"/><message id="m" name="m" itemRef="item"/>', ids: ['m'], note: 'an item definition without structureRef does not exist for the engine' },
      { head: '<itemDefinition id="item" structureRef="xsd:string"/><message id="m" name="m" itemRef="other:item"/>', defs: 'xmlns:other="urn:other"', ids: ['m'], note: 'a prefix bound to another namespace names nothing of this file' },
    ],
    good: [
      { head: '<itemDefinition id="item" structureRef="xsd:string"/><message id="m" name="m" itemRef="item"/>' },
      { head: '<itemDefinition id="item" structureRef="xsd:string"/><message id="m" name="m" itemRef="tns:item"/>', defs: 'xmlns:tns="urn:fixture"', note: 'a prefix bound to the target namespace names the same item definition' },
    ],
  }),
  defineRule({
    id: 'multi-instance-missing-collection',
    tag: 'V',
    key: 'MULTI_INSTANCE_MISSING_COLLECTION',
    severity: 'error',
    title: 'A multi-instance activity has neither a cardinality nor a collection',
    why: 'Activiti cannot tell how many instances to create. The validator does not check the multi-instance sub process itself, only tasks and call activities.',
    evidence: [R1_7, 'R1 §3.6'],
    howToFix: 'Set **Loop cardinality** or **Collection** in the multi-instance group.',
    entry: 'mi.type',
    serverKeys: ['MULTI_INSTANCE_MISSING_COLLECTION'],
    check: onTypes('bpmn:Activity', (activity, api) => {
      const loop = child(activity, 'loopCharacteristics');
      if (!loop || !is(loop, 'bpmn:MultiInstanceLoopCharacteristics') || is(activity, 'bpmn:SubProcess')) return;
      const cardinality = child(loop, 'loopCardinality');
      const hasCardinality = !isBlank(typeof cardinality?.['body'] === 'string' ? (cardinality['body'] as string) : undefined);
      const hasCollection = !isBlank(str(loop, 'activiti:collection')) || !isBlank(str(loop, 'loopDataInputRef')) || !isBlank(typeof loop['loopDataInputRef'] === 'string' ? (loop['loopDataInputRef'] as string) : undefined);
      if (!hasCardinality && !hasCollection) api.report(activity, `${activity.id} is multi-instance but has no loop cardinality and no collection`);
    }),
    bad: [{ body: '<userTask id="u"><multiInstanceLoopCharacteristics/></userTask>', ids: ['u'] }],
    good: [
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics><loopCardinality>3</loopCardinality></multiInstanceLoopCharacteristics></userTask>' },
      { body: '<userTask id="u"><multiInstanceLoopCharacteristics activiti:collection="people"/></userTask>' },
    ],
  }),
  defineRule({
    id: 'data-association-missing-targetref',
    tag: 'V',
    key: 'DATA_ASSOCIATION_MISSING_TARGETREF',
    severity: 'error',
    title: 'A data input / output association of an activity has no target',
    why: 'Activiti checks `targetRef` of the data associations of every activity.',
    evidence: [R1_7],
    howToFix: 'Reconnect or delete the data association.',
    quickFix: 'remove-element',
    serverKeys: ['DATA_ASSOCIATION_MISSING_TARGETREF'],
    check: onTypes('bpmn:Activity', (activity, api) => {
      if (is(activity, 'bpmn:SubProcess')) return;
      for (const association of [...list(activity, 'dataInputAssociations'), ...list(activity, 'dataOutputAssociations')]) {
        if (!association.get('targetRef')) api.report(activity, `A data association of ${activity.id} has no target`);
      }
    }),
    bad: [{ body: '<task id="t"><dataInputAssociation id="da"><sourceRef>x</sourceRef></dataInputAssociation></task>', ids: ['t'] }],
    good: [{ body: '<task id="t"><ioSpecification id="io"><dataInput id="di1"/><inputSet><dataInputRefs>di1</dataInputRefs></inputSet><outputSet/></ioSpecification><dataInputAssociation id="da"><targetRef>di1</targetRef></dataInputAssociation></task>' }],
  }),
  // --- diagram references (warnings)
  ...(
    [
      ['di-invalid-reference', 'DI_INVALID_REFERENCE', 'A diagram shape or edge refers to an element the Activiti model does not contain', 'invalid'],
      ['di-does-not-reference-flownode', 'DI_DOES_NOT_REFERENCE_FLOWNODE', 'A diagram shape refers to a flow element that is not a flow node', 'notFlowNode'],
      ['di-does-not-reference-seq-flow', 'DI_DOES_NOT_REFERENCE_SEQ_FLOW', 'A diagram edge refers to a flow element that is not a sequence flow', 'notSequenceFlow'],
    ] as const
  ).map(([id, key, title, kind]) =>
    defineRule({
      id,
      tag: 'V',
      key,
      severity: 'warn',
      title,
      why:
        kind === 'invalid'
          ? 'Activiti 9 has no model element for a `dataObjectReference`, a data association or a `group`, so a drawn one makes the engine warn (engine finding C18.2). The process still deploys and runs; the data object itself is edited without a shape (**Data objects** in the process properties) to keep deployments warning-free.'
          : kind === 'notFlowNode'
            ? 'A `dataStoreReference` is a flow element but no flow node in the Activiti model (engine finding C18.2).'
            : 'The edge points at a flow element that is not a sequence flow.',
      evidence: [R1_7, 'engine-findings C18.2'],
      howToFix: kind === 'invalid' ? 'Remove the shape (the data object stays declared in the properties), or accept the warning.' : 'Remove the drawn reference.',
      serverKeys: [key],
      check: (node, api) => {
        const isShape = node.$type === 'bpmndi:BPMNShape';
        const isEdge = node.$type === 'bpmndi:BPMNEdge';
        if (!isShape && !isEdge) return;
        const element = node.get('bpmnElement') as ME | undefined;
        const name = element?.id ?? node.id ?? '';
        if (!element) {
          if (kind === 'invalid') api.report(node, `The diagram element ${node.id} refers to nothing`);
          return;
        }
        const known = isShape
          ? is(element, 'bpmn:FlowNode') || is(element, 'bpmn:TextAnnotation') || is(element, 'bpmn:Association') || is(element, 'bpmn:Participant') || is(element, 'bpmn:Lane')
          : is(element, 'bpmn:SequenceFlow') || is(element, 'bpmn:MessageFlow') || is(element, 'bpmn:Association');
        const notFlowNode = isShape && is(element, 'bpmn:DataStoreReference');
        const dataAssociation = is(element, 'bpmn:DataAssociation') || is(element, 'bpmn:DataObjectReference') || is(element, 'bpmn:Group') || is(element, 'bpmn:DataObject');
        const flowNodeOnEdge = isEdge && is(element, 'bpmn:FlowNode');
        if (kind === 'invalid' && ((!known && !notFlowNode && !flowNodeOnEdge) || dataAssociation)) api.report(element, `${name} is drawn, but Activiti 9 has no model element for it`);
        if (kind === 'notFlowNode' && notFlowNode) api.report(element, `${name} is a data store reference, not a flow node`);
        if (kind === 'notSequenceFlow' && flowNodeOnEdge) api.report(element, `The edge ${node.id} points at ${name}, which is not a sequence flow`);
      },
      bad: [
        kind === 'invalid'
          ? { body: '<dataObjectReference id="dor" dataObjectRef="d1"/><dataObject id="d1" name="d1"/>', xml: diagramFixture('<bpmndi:BPMNShape id="dor_di" bpmnElement="dor"><dc:Bounds x="100" y="100" width="36" height="50"/></bpmndi:BPMNShape>', '<dataObjectReference id="dor" dataObjectRef="d1"/><dataObject id="d1" name="d1"/>'), ids: ['dor'] }
          : kind === 'notFlowNode'
            ? { xml: diagramFixture('<bpmndi:BPMNShape id="ds_di" bpmnElement="ds"><dc:Bounds x="100" y="100" width="36" height="50"/></bpmndi:BPMNShape>', '<dataStoreReference id="ds"/>'), ids: ['ds'] }
            : { xml: diagramFixture('<bpmndi:BPMNEdge id="t_di" bpmnElement="t"><di:waypoint x="1" y="1"/><di:waypoint x="2" y="2"/></bpmndi:BPMNEdge>', '<task id="t"/>'), ids: ['t'] },
      ],
      good: [{ xml: diagramFixture('<bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape>', '<task id="t"/>') }],
    }),
  ),
  // --- async executor off (client rules fire only when the context says so)
  ...(
    [
      ['flow-element-async-not-available', 'FLOW_ELEMENT_ASYNC_NOT_AVAILABLE', 'An element is async but the engine has no async executor', 'bpmn:FlowNode', (n: ME) => bool(n, 'activiti:async') === true],
      ['event-timer-async-not-available', 'EVENT_TIMER_ASYNC_NOT_AVAILABLE', 'A timer event needs the async executor, which is off', 'bpmn:Event', (n: ME) => list(n, 'eventDefinitions').some((d) => is(d, 'bpmn:TimerEventDefinition'))],
      ['signal-async-not-available', 'SIGNAL_ASYNC_NOT_AVAILABLE', 'An asynchronous signal throw needs the async executor, which is off', 'bpmn:Event', (n: ME) => list(n, 'eventDefinitions').some((d) => is(d, 'bpmn:SignalEventDefinition') && bool(d, 'activiti:async') === true)],
    ] as const
  ).map(([id, key, title, type, test]) =>
    defineRule({
      id,
      tag: 'V',
      key,
      severity: 'warn',
      title,
      why: 'The Spring Boot starter adds this warning when `spring.activiti.async-executor-activate=false`: async continuations, timers and asynchronous signals never run then. The rule only fires when the connected engine reports that its executor is off (the context says `asyncExecutorActive: false`); the server validation also reports it (labelled).',
      evidence: [R1_7, 'R1 §0.4-24', 'engine-findings 5'],
      howToFix: 'Switch the async executor on (`spring.activiti.async-executor-activate=true`, the default) or remove the async flag.',
      needs: ['server'],
      serverKeys: [key, `ACTIVITI_${key}`],
      check: onTypes(type, (node, api) => {
        if (api.ctx.asyncExecutorActive === false && test(node)) api.report(node, `${title}`);
      }),
      bad: [{ body: id === 'flow-element-async-not-available' ? '<task id="t" activiti:async="true"/>' : id === 'event-timer-async-not-available' ? '<intermediateCatchEvent id="t"><timerEventDefinition><timeDuration>PT1M</timeDuration></timerEventDefinition></intermediateCatchEvent>' : '<intermediateThrowEvent id="t"><signalEventDefinition signalRef="s" activiti:async="true"/></intermediateThrowEvent>', head: id === 'signal-async-not-available' ? '<signal id="s" name="go"/>' : undefined, context: { asyncExecutorActive: false }, ids: ['t'] }],
      good: [{ body: id === 'flow-element-async-not-available' ? '<task id="t" activiti:async="true"/>' : '<task id="t"/>', context: { asyncExecutorActive: true } }, { body: '<task id="t" activiti:async="true"/>' }],
    }),
  ),
];

/** A document with a diagram and the given flow elements; `planeElements` are the shapes / edges of its plane. */
function diagramFixture(planeElements: string, flowElements: string): string {
  return `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:activiti="http://activiti.org/bpmn" id="d" targetNamespace="urn:t">
  <process id="p" isExecutable="true">${flowElements}</process>
  <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">${planeElements}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;
}

