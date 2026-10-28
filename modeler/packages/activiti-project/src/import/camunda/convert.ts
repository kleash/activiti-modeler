import { defaultMappingType, wantsDefaultMapping, type MappingHostFacts } from '../../defaultMappings';
import { declareOutputTargets, emptyExtensionsFile, emptyProcessExtension, parseExtensions, serializeExtensions, type ExtensionsFile, type MappingValue, type ProcessExtension, type ProcessVariablesMapping } from '../../extensions';
import { ACTIVITI_NS, BPMN_NS, CAMUNDA_MODELER_NS, CAMUNDA_NS, detectCamundaDocument, isVendorNamespace, parseXml, XMLNS_NS, ZEEBE_NS_PREFIX } from './detect';
import { buildFormProperties } from './forms';
import { mappingValueOf, type ParameterValue, parameterValue } from './parameters';
import { Recorder } from './recorder';
import type { ConversionResult, ConvertOptions } from './types';

export const DMN_TABLE_CONSTANT = '_activiti_dmn_table_';
export const DMN_IMPLEMENTATION = 'dmn-connector.EXECUTE_TABLE';

/** Script formats with an engine on the default Activiti 9 classpath (as in the support matrix of the modeler). */
const SCRIPT_FORMATS = new Set(['juel', 'javascript', 'js', 'ecmascript', 'nashorn']);

const isTrue = (value: string): boolean => value.trim().toLowerCase() === 'true';
const bpmnChildren = (el: Element, name: string): Element[] => Array.from(el.children).filter((c) => c.namespaceURI === BPMN_NS && c.localName === name);

const REASONS = {
  asyncAfter: 'Activiti has only an asynchronous continuation before an activity (activiti:async); there is none after it',
  jobPriority: 'Activiti has no job priority',
  historyTimeToLive: 'Activiti has no history time to live; the history level is set on the engine',
  versionTag: 'Activiti has no version tag; deployments are versioned by number',
  taskPriority: 'Activiti has no default task priority (a user task has its own priority)',
  followUpDate: 'Activiti has no follow-up date for a task',
  form: 'Activiti has no form engine for Camunda forms; use activiti:formKey and an application-level form',
  external: 'Activiti has no external tasks; use a connector (a service task with a connector action) or a Java delegate',
  resource: 'Activiti cannot read a script or condition from a resource',
  binding: 'Activiti always calls the latest version of the called process',
  tenant: 'Activiti has no tenants',
  caseRef: 'Activiti has no CMMN cases',
  variableMapping: 'use activiti:in / activiti:out or the input / output mapping of the extensions file',
  errorVariable: 'Activiti does not copy the code or message of a caught error into a variable',
  conditional: 'Activiti does not parse conditional events',
  startable: 'Activiti has no tasklist',
  template: 'a Camunda element template is not understood by Activiti; the element keeps the properties the template had set',
  noEquivalent: 'Activiti has no equivalent',
  properties: 'Camunda extension properties have no meaning to Activiti',
  mappingTarget:
    'Activiti reads input / output mappings only on connector and decision service tasks, user tasks, call activities and message events; the engine ignores them elsewhere',
  script: 'Activiti has no script input / output parameters; write the value with an expression or a script task',
  outputExpression: 'Activiti refuses an expression in an output mapping; only a variable of the result or a fixed value can be mapped',
  listenerScript: 'Activiti listeners are classes, expressions or delegate expressions; there are no script listeners',
  listenerEvent: 'Activiti has only these listener events',
} as const;

/** Reason and handling of the attributes that have no counterpart, by local name. */
function lossReason(local: string): string {
  switch (local) {
    case 'asyncAfter': return REASONS.asyncAfter;
    case 'jobPriority': return REASONS.jobPriority;
    case 'historyTimeToLive': return REASONS.historyTimeToLive;
    case 'versionTag': return REASONS.versionTag;
    case 'taskPriority': return REASONS.taskPriority;
    case 'followUpDate': return REASONS.followUpDate;
    case 'formRef': case 'formRefBinding': case 'formRefVersion': case 'formHandlerClass': return REASONS.form;
    case 'type': case 'topic': return REASONS.external;
    case 'resource': return REASONS.resource;
    case 'calledElementBinding': case 'calledElementVersion': case 'calledElementVersionTag': return REASONS.binding;
    case 'calledElementTenantId': case 'decisionRefTenantId': case 'caseTenantId': return REASONS.tenant;
    case 'caseRef': case 'caseBinding': case 'caseVersion': return REASONS.caseRef;
    case 'variableMappingClass': case 'variableMappingDelegateExpression': return REASONS.variableMapping;
    case 'errorCodeVariable': case 'errorMessageVariable': case 'escalationCodeVariable': return REASONS.errorVariable;
    case 'variableName': case 'variableEvents': return REASONS.conditional;
    case 'isStartableInTasklist': return REASONS.startable;
    case 'modelerTemplate': case 'modelerTemplateVersion': case 'modelerTemplateIcon': return REASONS.template;
    default: return REASONS.noEquivalent;
  }
}

/** Attributes that carry metadata only: reported as information. */
const INFO_ATTRIBUTES = new Set(['modelerTemplate', 'modelerTemplateVersion', 'modelerTemplateIcon']);

/** Children that have an id of their own but are part of the element they sit in: the report names the element. */
const PART_OF_ELEMENT = /(EventDefinition|LoopCharacteristics|^conditionExpression$|^completionCondition$|^script$)/;

interface Owner {
  id: string;
  name?: string;
  type: string;
}

export class Converter {
  readonly doc: Document;
  readonly options: ConvertOptions;
  readonly recorder: Recorder;
  readonly extensions: ExtensionsFile;
  private counter = 0;
  private prefix = 'camunda';

  constructor(doc: Document, options: ConvertOptions, extensions: ExtensionsFile) {
    this.doc = doc;
    this.options = options;
    this.recorder = new Recorder(options.fileName ?? 'process.bpmn');
    this.extensions = extensions;
  }

  private newId = (): string => this.options.newId?.() ?? `var-${(this.counter += 1)}`;

  /** The element a thing belongs to for the report: the nearest ancestor with an id. */
  private owner(el: Element): Owner {
    for (let cursor: Element | null = el; cursor; cursor = cursor.parentElement) {
      const id = cursor.getAttribute('id');
      if (id && cursor.namespaceURI === BPMN_NS && !PART_OF_ELEMENT.test(cursor.localName)) {
        const name = cursor.getAttribute('name');
        return { id, ...(name ? { name } : {}), type: `bpmn:${cursor.localName}` };
      }
    }
    return { id: '', type: `bpmn:${el.localName}` };
  }

  private processExtension(el: Element): ProcessExtension {
    let id = '';
    for (let cursor: Element | null = el; cursor; cursor = cursor.parentElement) {
      if (cursor.namespaceURI === BPMN_NS && cursor.localName === 'process') {
        id = cursor.getAttribute('id') ?? '';
        break;
      }
    }
    return (this.extensions.extensions[id] ??= emptyProcessExtension());
  }

  private describe(prefix: string | null, local: string, value?: string): string {
    const name = `${prefix ?? this.prefix}:${local}`;
    if (value === undefined) return `<${name}>`;
    return `${name}="${value.length > 90 ? `${value.slice(0, 87)}...` : value}"`;
  }

  /** An element as written in the file: `<camunda:inputParameter name="rule">`. */
  private tag(el: Element, attrs: string[] = ['name']): string {
    const shown = attrs.filter((a) => el.getAttribute(a) !== null).map((a) => ` ${a}="${el.getAttribute(a)}"`).join('');
    return `<${el.prefix ?? this.prefix}:${el.localName}${shown}>`;
  }

  /** `camunda:asyncBefore="true"`, with the element it sits on when that is not the one the report names. */
  private attributeText(el: Element, attr: Attr): string {
    const text = this.describe(attr.prefix, attr.localName, attr.value);
    const owner = this.owner(el);
    return owner.id && el.getAttribute('id') !== owner.id ? `${text} (on ${el.prefix ? `${el.prefix}:` : ''}${el.localName})` : text;
  }

  // --- attributes -----------------------------------------------------------------------------------------------------------

  /** Moves an attribute to the Activiti namespace. */
  private rename(el: Element, attr: Attr, to: string, value = attr.value): void {
    const owner = this.owner(el);
    el.removeAttributeNS(attr.namespaceURI, attr.localName);
    el.setAttributeNS(ACTIVITI_NS, `activiti:${to}`, value);
    this.recorder.converted(owner, this.attributeText(el, attr), `activiti:${to}="${value}"`);
  }

  private drop(el: Element, attr: Attr, kind: 'dropped' | 'approximated' | 'info', why: string, what = 'dropped'): void {
    this.recorder.entry(this.owner(el), kind, this.attributeText(el, attr), what, why);
    el.removeAttributeNS(attr.namespaceURI, attr.localName);
  }

  private convertAttributes(el: Element): void {
    const type = el.localName;
    for (const attr of Array.from(el.attributes)) {
      const uri = attr.namespaceURI;
      if (uri === XMLNS_NS || !isVendorNamespace(uri)) continue;
      if (uri === CAMUNDA_MODELER_NS) {
        this.drop(el, attr, 'info', 'metadata of the Camunda Modeler; Activiti does not use it');
        continue;
      }
      if (uri?.startsWith(ZEEBE_NS_PREFIX)) {
        this.drop(el, attr, 'dropped', 'a Camunda 8 (Zeebe) attribute; Activiti runs Camunda 7 style models');
        continue;
      }
      if (uri !== CAMUNDA_NS) {
        this.drop(el, attr, 'dropped', REASONS.noEquivalent);
        continue;
      }
      this.convertAttribute(el, attr, type);
    }
  }

  private convertAttribute(el: Element, attr: Attr, type: string): void {
    const local = attr.localName;
    const value = attr.value;
    const rename = (to = local): void => this.rename(el, attr, to);
    const lose = (why = lossReason(local), kind: 'dropped' | 'approximated' | 'info' = 'dropped'): void => this.drop(el, attr, kind, why);

    switch (local) {
      case 'asyncBefore':
        if (type === 'multiInstanceLoopCharacteristics') return isTrue(value) ? lose('Activiti has no asynchronous continuation of the loop itself; the activity can be async') : this.silent(el, attr);
        return isTrue(value) ? rename('async') : this.silent(el, attr);
      case 'asyncAfter':
        return isTrue(value) ? lose() : this.silent(el, attr);
      case 'exclusive':
        return type === 'multiInstanceLoopCharacteristics' ? lose('Activiti has no job settings for the loop itself') : rename();
      case 'assignee': case 'candidateUsers': case 'candidateGroups': case 'dueDate': case 'priority':
        return type === 'userTask' ? rename() : lose();
      case 'formKey':
        return type === 'userTask' || type === 'startEvent' ? rename() : lose();
      case 'initiator':
        return type === 'startEvent' ? rename() : lose();
      case 'candidateStarterUsers': case 'candidateStarterGroups':
        return type === 'process' ? rename() : lose();
      case 'collection': case 'elementVariable':
        return type === 'multiInstanceLoopCharacteristics' ? rename() : lose();
      case 'class': case 'delegateExpression':
        return type === 'serviceTask' || type === 'sendTask' || type === 'messageEventDefinition' ? rename() : lose();
      case 'expression':
        if (type === 'serviceTask' || type === 'sendTask') return rename();
        return lose(type === 'messageEventDefinition' ? 'Activiti sends a message through a class or a delegate expression, not an expression' : lossReason(local));
      case 'resultVariable':
        if (type === 'scriptTask') return rename();
        if (type === 'serviceTask' && (el.hasAttributeNS(CAMUNDA_NS, 'expression') || el.hasAttributeNS(ACTIVITI_NS, 'expression'))) return rename('resultVariableName');
        return lose(type === 'serviceTask' ? 'a Java class or delegate expression has no result variable; Activiti stores one only for an expression' : lossReason(local));
      case 'type':
        // `external` is the only type Camunda 7 knows on a service task
        return lose(lossReason('type'));
      case 'calledElementBinding':
        return value === 'latest' || value === '' ? this.silent(el, attr) : lose();
      case 'calledElementVersion': case 'calledElementVersionTag':
        return lose();
      default:
        return INFO_ATTRIBUTES.has(local) ? lose(lossReason(local), 'info') : lose();
    }
  }

  /** An attribute that says what Activiti does anyway (`asyncBefore="false"`): removed without a line in the report. */
  private silent(el: Element, attr: Attr): void {
    el.removeAttributeNS(attr.namespaceURI, attr.localName);
  }

  // --- extension elements -----------------------------------------------------------------------------------------------------

  private removeNode(node: Node): void {
    const before = node.previousSibling;
    if (before && before.nodeType === 3 && (before.textContent ?? '').trim() === '') before.parentNode?.removeChild(before);
    node.parentNode?.removeChild(node);
  }

  /** Replaces an element by new ones at the same place (with the indentation of the old one). */
  private replaceWith(old: Element, created: Element[]): void {
    for (const el of created) old.parentNode?.insertBefore(el, old);
    if (created.length > 0) {
      // give the new elements the indentation the old one had
      const before = old.previousSibling;
      const indent = before && before.nodeType === 3 ? before.textContent : null;
      if (indent !== null && indent.trim() === '') {
        for (const el of created.slice(1)) old.parentNode?.insertBefore(this.doc.createTextNode(indent), el);
      }
    }
    this.removeNode(old);
  }

  private activitiElement(name: string, attrs: Record<string, string | undefined> = {}): Element {
    const el = this.doc.createElementNS(ACTIVITI_NS, `activiti:${name}`);
    for (const [key, value] of Object.entries(attrs)) if (value !== undefined) el.setAttribute(key, value);
    return el;
  }

  /** Copies the children of an element into a new Activiti element, converting `field`s on the way. */
  private convertFieldElement(field: Element): Element {
    const out = this.activitiElement('field', { name: field.getAttribute('name') ?? undefined });
    for (const attr of ['stringValue', 'expression']) {
      const value = field.getAttribute(attr);
      if (value !== null) out.setAttribute(attr, value);
    }
    for (const child of Array.from(field.children)) {
      if (child.namespaceURI === CAMUNDA_NS && (child.localName === 'string' || child.localName === 'expression')) {
        const converted = this.activitiElement(child.localName);
        converted.textContent = child.textContent;
        out.appendChild(converted);
      }
    }
    return out;
  }

  private convertListener(listener: Element, owner: Owner): Element | undefined {
    const isTask = listener.localName === 'taskListener';
    const event = listener.getAttribute('event') ?? '';
    const label = this.tag(listener, ['event', 'class', 'expression', 'delegateExpression']);
    const scriptChild = Array.from(listener.children).find((c) => c.namespaceURI === CAMUNDA_NS && (c.localName === 'script' || c.localName === 'timerEventDefinition'));
    if (scriptChild) {
      this.recorder.entry(owner, 'dropped', `${label} containing ${this.tag(scriptChild, [])}`, 'listener dropped', scriptChild.localName === 'script' ? REASONS.listenerScript : 'Activiti has no timeout task listener');
      return undefined;
    }
    const events = isTask ? ['create', 'assignment', 'complete', 'delete'] : ['start', 'end', 'take'];
    if (event && !events.includes(event)) {
      this.recorder.entry(owner, 'dropped', label, 'listener dropped', `${REASONS.listenerEvent}: ${events.join(', ')}`);
      return undefined;
    }
    const out = this.activitiElement(listener.localName);
    for (const attr of Array.from(listener.attributes)) {
      if (attr.namespaceURI === XMLNS_NS) continue;
      if (attr.namespaceURI === null && ['event', 'class', 'expression', 'delegateExpression'].includes(attr.localName)) out.setAttribute(attr.localName, attr.value);
      else if (attr.namespaceURI === null || attr.namespaceURI === CAMUNDA_NS) {
        this.recorder.entry(owner, 'dropped', this.describe(attr.prefix, attr.localName, attr.value), `attribute of ${label} dropped`, REASONS.noEquivalent);
      }
    }
    for (const child of Array.from(listener.children)) {
      if (child.namespaceURI === CAMUNDA_NS && child.localName === 'field') out.appendChild(this.convertFieldElement(child));
    }
    this.recorder.converted(owner, label, `<activiti:${listener.localName}${event ? ` event="${event}"` : ''}>`);
    return out;
  }

  private convertExtensionChild(child: Element, host: Element, owner: Owner): void {
    const local = child.localName;
    const hostType = host.localName;
    const loseAll = (what: string, why: string, kind: 'dropped' | 'approximated' | 'info' = 'dropped'): void => {
      this.recorder.entry(owner, kind, this.describe(child.prefix, local), what, why);
      this.removeNode(child);
    };

    switch (local) {
      case 'executionListener': case 'taskListener': {
        const converted = this.convertListener(child, owner);
        if (converted) this.replaceWith(child, [converted]);
        else this.removeNode(child);
        return;
      }
      case 'field': {
        if (hostType === 'serviceTask' || hostType === 'sendTask' || hostType === 'messageEventDefinition') {
          this.replaceWith(child, [this.convertFieldElement(child)]);
          this.recorder.converted(owner, this.tag(child), `<activiti:field name="${child.getAttribute('name') ?? ''}">`);
        } else loseAll('dropped', 'Activiti injects fields only into service tasks, send tasks, listeners and message definitions');
        return;
      }
      case 'failedJobRetryTimeCycle': {
        const converted = this.activitiElement('failedJobRetryTimeCycle');
        converted.textContent = child.textContent;
        this.replaceWith(child, [converted]);
        this.recorder.converted(owner, this.describe(child.prefix, local), '<activiti:failedJobRetryTimeCycle>');
        return;
      }
      case 'properties': {
        const items = Array.from(child.children).map((p) => `${p.getAttribute('name') ?? ''}=${p.getAttribute('value') ?? ''}`);
        this.recorder.entry(owner, 'dropped', `${this.describe(child.prefix, local)}${items.length > 0 ? ` (${items.join(', ')})` : ''}`, 'dropped', REASONS.properties);
        this.removeNode(child);
        return;
      }
      case 'connector': {
        const id = child.getElementsByTagNameNS(CAMUNDA_NS, 'connectorId')[0]?.textContent?.trim();
        loseAll(`connector${id ? ` ${id}` : ''} dropped`, 'Camunda connectors do not exist in Activiti; use a service task with a connector action');
        return;
      }
      case 'formData': {
        const result = buildFormProperties(this, child);
        for (const note of result.notes) this.recorder.entry(owner, note.kind, note.item, note.what, note.why);
        this.replaceWith(child, result.elements);
        if (result.elements.length > 0) this.recorder.converted(owner, this.describe(child.prefix, local), `${result.elements.length} <activiti:formProperty>`);
        return;
      }
      case 'inputOutput':
        this.convertInputOutput(child, host, owner);
        this.removeNode(child);
        return;
      case 'in': case 'out':
        if (hostType === 'callActivity') this.convertCallParameter(child, host, owner);
        else loseAll('dropped', REASONS.noEquivalent);
        return;
      case 'errorEventDefinition':
        loseAll('dropped', 'Activiti has no external task error definition');
        return;
      default:
        loseAll('dropped', lossReason(local));
    }
  }

  // --- call activities ------------------------------------------------------------------------------------------------------

  private convertCallParameter(param: Element, host: Element, owner: Owner): void {
    const direction = param.localName;
    const attrs = Object.fromEntries(Array.from(param.attributes).filter((a) => a.namespaceURI === null).map((a) => [a.localName, a.value]));
    const text = this.tag(param, ['source', 'sourceExpression', 'target', 'variables', 'businessKey', 'local']);

    if (attrs['businessKey'] !== undefined) {
      if (direction === 'in') {
        const inherit = /^[#$]\{\s*execution\.processBusinessKey\s*\}$/.test(attrs['businessKey'].trim());
        if (inherit) host.setAttributeNS(ACTIVITI_NS, 'activiti:inheritBusinessKey', 'true');
        else host.setAttributeNS(ACTIVITI_NS, 'activiti:businessKey', attrs['businessKey']);
        this.recorder.converted(owner, text, inherit ? 'activiti:inheritBusinessKey="true"' : `activiti:businessKey="${attrs['businessKey']}"`);
      } else this.recorder.entry(owner, 'dropped', text, 'dropped', REASONS.noEquivalent);
      this.removeNode(param);
      return;
    }
    if (attrs['variables'] === 'all') {
      if (direction === 'in') {
        host.setAttributeNS(ACTIVITI_NS, 'activiti:inheritVariables', 'true');
        this.recorder.converted(owner, text, 'activiti:inheritVariables="true"');
      } else {
        const mapping = (this.processExtension(host).mappings[owner.id] ??= {});
        mapping.mappingType = mapping.mappingType === 'MAP_ALL_INPUTS' || mapping.mappingType === 'MAP_ALL' ? 'MAP_ALL' : 'MAP_ALL_OUTPUTS';
        this.recorder.converted(owner, text, `mappings.${owner.id}.mappingType = ${mapping.mappingType}`);
        this.recorder.entry(owner, 'approximated', text, 'converted to an output mapping of all variables (MAP_ALL_OUTPUTS)', 'Activiti returns the variables of the called process through the extensions mapping; the called process needs an entry in its own extensions file for the inputs');
      }
      this.removeNode(param);
      return;
    }
    if (attrs['local'] === 'true') this.recorder.entry(owner, 'approximated', text, 'converted without the local flag', 'Activiti sets in and out parameters as ordinary variables of the other instance');
    const created = this.activitiElement(direction);
    if (attrs['source'] !== undefined) created.setAttribute('source', attrs['source']);
    if (attrs['sourceExpression'] !== undefined) created.setAttribute('sourceExpression', attrs['sourceExpression']);
    if (attrs['target'] !== undefined) created.setAttribute('target', attrs['target']);
    this.replaceWith(param, [created]);
    this.recorder.converted(owner, text, `<activiti:${direction}>`);
  }

  // --- input / output parameters ----------------------------------------------------------------------------------------------

  /** What the engine does with a mapping on this element. */
  private mappingSupport(host: Element): { inputs: boolean; outputs: boolean } {
    const t = host.localName;
    const hasMessage = Array.from(host.children).some((c) => c.namespaceURI === BPMN_NS && c.localName === 'messageEventDefinition');
    const hasMessageOrSignal = Array.from(host.children).some((c) => c.namespaceURI === BPMN_NS && (c.localName === 'messageEventDefinition' || c.localName === 'signalEventDefinition'));
    switch (t) {
      case 'userTask': case 'callActivity': return { inputs: true, outputs: true };
      case 'serviceTask': return host.hasAttribute('implementation') ? { inputs: true, outputs: true } : { inputs: false, outputs: false };
      case 'startEvent': return { inputs: false, outputs: true };
      case 'intermediateCatchEvent': case 'boundaryEvent': return { inputs: false, outputs: hasMessageOrSignal && hasMessage };
      case 'intermediateThrowEvent': case 'endEvent': return { inputs: hasMessage, outputs: false };
      default: return { inputs: false, outputs: false };
    }
  }

  private convertInputOutput(node: Element, host: Element, owner: Owner): void {
    const support = this.mappingSupport(host);
    const ext = this.processExtension(host);
    const mapping: ProcessVariablesMapping = ext.mappings[owner.id] ?? {};
    const inputs: Record<string, MappingValue> = { ...(mapping.inputs ?? {}) };
    const outputs: Record<string, MappingValue> = { ...(mapping.outputs ?? {}) };

    for (const param of Array.from(node.children)) {
      if (param.namespaceURI !== CAMUNDA_NS) continue;
      const isInput = param.localName === 'inputParameter';
      if (!isInput && param.localName !== 'outputParameter') continue;
      const name = param.getAttribute('name') ?? '';
      const label = this.tag(param);
      if (!name) {
        this.recorder.entry(owner, 'dropped', label, 'dropped', 'a parameter needs a name');
        continue;
      }
      if (!(isInput ? support.inputs : support.outputs)) {
        this.recorder.entry(owner, 'dropped', `${label} = ${summarize(param)}`, 'dropped', `${REASONS.mappingTarget} (${owner.type})`);
        continue;
      }
      const value = parameterValue(param);
      if (!value.ok) {
        this.recorder.entry(owner, 'dropped', `${label} = ${summarize(param)}`, 'dropped', value.reason === 'script' ? REASONS.script : value.reason);
        continue;
      }
      if (isInput) {
        inputs[name] = mappingValueOf(value as ParameterValue & { ok: true }, 'input');
        this.recorder.converted(owner, label, `mappings.${owner.id}.inputs.${name}`);
      } else {
        const mapped = mappingValueOf(value as ParameterValue & { ok: true }, 'output');
        if (mapped === 'expression') {
          this.recorder.entry(owner, 'dropped', `${label} = ${summarize(param)}`, 'dropped', REASONS.outputExpression);
          continue;
        }
        outputs[name] = mapped;
        this.recorder.converted(owner, label, `mappings.${owner.id}.outputs.${name}`);
      }
    }

    if (Object.keys(inputs).length === 0 && Object.keys(outputs).length === 0) return;
    const next: ProcessVariablesMapping = { ...mapping };
    if (Object.keys(inputs).length > 0) next.inputs = inputs;
    if (Object.keys(outputs).length > 0) next.outputs = outputs;
    ext.mappings[owner.id] = next;
    const added = declareOutputTargets(ext, next, this.newId);
    const guessed = added.filter((name) => Object.values(ext.properties).find((p) => p.name === name)?.type === 'json');
    if (guessed.length > 0) {
      this.recorder.entry(owner, 'info', `output variables ${guessed.join(', ')}`, 'declared as process variables of the type json', 'Activiti drops the output of a variable that is not declared; the type of the source is not known here, so check the types in the Variables group');
    }
  }

  // --- business rule tasks ---------------------------------------------------------------------------------------------------

  /** A business rule task becomes a decision task (a service task of the DMN connector) or, with a class or expression, a service task. */
  private convertBusinessRuleTask(el: Element): Element {
    const owner = this.owner(el);
    const camunda = (name: string): string | null => el.getAttributeNS(CAMUNDA_NS, name);
    const ref = camunda('decisionRef');
    const replacement = this.doc.createElementNS(BPMN_NS, el.prefix ? `${el.prefix}:serviceTask` : 'serviceTask');
    for (const attr of Array.from(el.attributes)) replacement.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    while (el.firstChild) replacement.appendChild(el.firstChild);
    el.parentNode?.replaceChild(replacement, el);

    const take = (name: string): void => {
      replacement.removeAttributeNS(CAMUNDA_NS, name);
    };
    this.recorder.converted(owner, '<bpmn:businessRuleTask>', '<bpmn:serviceTask>');
    if (ref !== null) {
      const ext = this.processExtension(replacement);
      replacement.setAttribute('implementation', DMN_IMPLEMENTATION);
      (ext.constants[owner.id] ??= {})[DMN_TABLE_CONSTANT] = { value: ref };
      this.recorder.converted(owner, `${this.describe('camunda', 'decisionRef', ref)}`, `decision task, constant ${DMN_TABLE_CONSTANT} = ${ref}`);
      take('decisionRef');
      for (const name of ['decisionRefBinding', 'decisionRefVersion', 'decisionRefVersionTag', 'decisionRefTenantId']) {
        const attr = replacement.getAttributeNodeNS(CAMUNDA_NS, name);
        if (attr && !(name === 'decisionRefBinding' && attr.value === 'latest')) this.recorder.entry(owner, 'dropped', this.describe(attr.prefix, name, attr.value), 'dropped', name.endsWith('TenantId') ? REASONS.tenant : 'the DMN connector always evaluates the decision with that id');
        take(name);
      }
      const resultVariable = replacement.getAttributeNodeNS(CAMUNDA_NS, 'resultVariable');
      const mapResult = replacement.getAttributeNodeNS(CAMUNDA_NS, 'mapDecisionResult');
      const decision = this.options.decision?.(ref);
      if (decision) this.mapDecision(replacement, owner, decision, resultVariable?.value);
      if (resultVariable || mapResult) {
        this.recorder.entry(
          owner,
          'approximated',
          [resultVariable, mapResult].filter((a): a is Attr => !!a).map((a) => this.describe(a.prefix, a.localName, a.value)).join(' '),
          decision ? 'the outputs of the decision are mapped by column name' : 'dropped: map the outputs of the decision in the Decision group',
          'the DMN connector returns each output column under its name (and the matched flag); Activiti has no result variable or result mapping for a decision',
        );
      }
      take('resultVariable');
      take('mapDecisionResult');
      if (!decision) {
        this.recorder.entry(owner, 'approximated', `decisionRef="${ref}"`, 'the DMN file is not part of the import', `add the DMN file with the decision "${ref}" to the project and use the Decision group to map its inputs and outputs`);
      }
    } else if (camunda('class') !== null || camunda('delegateExpression') !== null || camunda('expression') !== null) {
      this.recorder.entry(owner, 'approximated', '<bpmn:businessRuleTask>', 'converted to a service task', 'Activiti fails to deploy a business rule task (NullPointerException); a service task with the same implementation runs it');
    } else {
      this.recorder.entry(owner, 'dropped', '<bpmn:businessRuleTask>', 'converted to a service task without an implementation', 'the task named no decision and no class; give it an implementation');
    }
    return replacement;
  }

  private mapDecision(task: Element, owner: Owner, decision: NonNullable<ReturnType<NonNullable<ConvertOptions['decision']>>>, resultVariable: string | undefined): void {
    const ext = this.processExtension(task);
    const mapping: ProcessVariablesMapping = ext.mappings[owner.id] ?? {};
    const inputs = { ...(mapping.inputs ?? {}) };
    for (const name of decision.inputs) inputs[name] ??= { type: 'VARIABLE', value: name };
    const outputs = { ...(mapping.outputs ?? {}) };
    const types: Record<string, string> = {};
    for (const out of decision.outputs) {
      if (!out.name) continue;
      outputs[out.name] ??= { type: 'VARIABLE', value: out.name };
      if (out.type) types[out.name] = feelToVariableType(out.type);
    }
    if (resultVariable && decision.outputs.length === 1 && decision.outputs[0]?.name) {
      // a single output column: Camunda's result variable holds that value
      outputs[resultVariable] = { type: 'VARIABLE', value: decision.outputs[0].name };
      delete outputs[decision.outputs[0].name];
      if (decision.outputs[0].type) types[resultVariable] = feelToVariableType(decision.outputs[0].type);
    }
    const next: ProcessVariablesMapping = { ...mapping, inputs, outputs };
    ext.mappings[owner.id] = next;
    declareOutputTargets(ext, next, this.newId, { sourceTypes: types, knownTypes: types });
  }

  // --- the walk ---------------------------------------------------------------------------------------------------------------

  convert(): void {
    const root = this.doc.documentElement;
    const all = [root, ...Array.from(root.getElementsByTagName('*'))];

    // business rule tasks first: they change the element and consume their own attributes
    const rules = all.filter((el) => el.namespaceURI === BPMN_NS && el.localName === 'businessRuleTask');
    const replaced = new Map<Element, Element>();
    for (const el of rules) replaced.set(el, this.convertBusinessRuleTask(el));
    const elements = all.map((el) => replaced.get(el) ?? el).filter((el) => el.namespaceURI === BPMN_NS);

    for (const el of elements) {
      this.convertAttributes(el);
      this.checkScript(el);
    }
    for (const el of elements) {
      for (const ext of bpmnChildren(el, 'extensionElements')) {
        const owner = this.owner(el);
        for (const child of Array.from(ext.children)) {
          if (child.namespaceURI === CAMUNDA_NS) this.convertExtensionChild(child, el, owner);
          else if (child.namespaceURI?.startsWith(ZEEBE_NS_PREFIX)) {
            this.recorder.entry(owner, 'dropped', `<${child.prefix}:${child.localName}>`, 'dropped', 'a Camunda 8 (Zeebe) extension; Activiti runs Camunda 7 style models');
            this.removeNode(child);
          } else if (isVendorNamespace(child.namespaceURI)) {
            this.recorder.entry(owner, 'dropped', `<${child.prefix}:${child.localName}>`, 'dropped', REASONS.noEquivalent);
            this.removeNode(child);
          }
        }
        if (ext.children.length === 0 && (ext.textContent ?? '').trim() === '') this.removeNode(ext);
      }
    }
    this.defaultMappings(elements);
    this.dropExporter();
    this.sweep();
    this.declareNamespace();
  }

  /** `exporter="Camunda Modeler"`: the file is not exported by that tool any more once it is converted. */
  private dropExporter(): void {
    const root = this.doc.documentElement;
    const exporter = root.getAttribute('exporter');
    if (exporter === null || !/camunda/i.test(exporter)) return;
    const owner = this.owner(root);
    this.recorder.entry(owner, 'info', `exporter="${exporter}"`, 'dropped', 'the file is written by the Activiti modeler from now on');
    root.removeAttribute('exporter');
    root.removeAttribute('exporterVersion');
  }

  /** Script formats and condition languages that need an engine Activiti does not bring. */
  private checkScript(el: Element): void {
    if (el.localName === 'scriptTask') {
      const format = (el.getAttribute('scriptFormat') ?? '').toLowerCase();
      if (format && !SCRIPT_FORMATS.has(format)) {
        this.recorder.entry(this.owner(el), 'approximated', `scriptFormat="${el.getAttribute('scriptFormat')}"`, 'kept', 'Activiti runs JavaScript and JUEL out of the box; other languages need a JSR-223 engine on the classpath of the application');
      }
    }
    if (el.localName === 'conditionExpression') {
      const language = (el.getAttribute('language') ?? '').toLowerCase();
      if (language && language !== 'juel') {
        this.recorder.entry(this.owner(el), 'approximated', `conditionExpression language="${el.getAttribute('language')}"`, 'kept', 'Activiti evaluates conditions as JUEL only; a script condition fails at run time');
      }
    }
  }

  /**
   * User tasks and message catch events without parameters get the default mapping of a new element (ADR 0006), decided by
   * `wantsDefaultMapping` / `defaultMappingType` (MAP_ALL; MAP_ALL_OUTPUTS on a multi-instance user task; none on a signal catch event).
   * Call activities are the importer's one exception: Camunda passes only what their parameters say.
   */
  private defaultMappings(elements: Element[]): void {
    if ((this.options.defaultMappings ?? 'mapAll') !== 'mapAll') return;
    for (const el of elements) {
      const id = el.getAttribute('id');
      if (!id) continue;
      const bpmnChildren = Array.from(el.children).filter((c) => c.namespaceURI === BPMN_NS);
      const parent = el.parentElement;
      const host: MappingHostFacts = {
        type: el.localName,
        eventDefinitions: bpmnChildren.filter((c) => c.localName.endsWith('EventDefinition')).map((c) => c.localName),
        multiInstance: bpmnChildren.some((c) => c.localName === 'multiInstanceLoopCharacteristics'),
        inEventSubProcess: parent?.localName === 'subProcess' && parent.getAttribute('triggeredByEvent') === 'true',
      };
      // Camunda passes a call activity only what its parameters say, so the importer leaves it alone (the editor gives a new one MAP_ALL)
      if (host.type === 'callActivity' || !wantsDefaultMapping(host)) continue;
      const ext = this.processExtension(el);
      if (ext.mappings[id]) continue;
      const mappingType = defaultMappingType(host);
      ext.mappings[id] = { mappingType };
      this.recorder.entry(
        { id, ...(el.getAttribute('name') ? { name: el.getAttribute('name') as string } : {}), type: `bpmn:${el.localName}` },
        'info',
        el.localName === 'userTask' ? 'a user task without input / output parameters' : 'a message catch event without parameters',
        `${mappingType} added to the mapping`,
        'Camunda hands the variables of a completed task or a received message to the process by itself; Activiti needs a mapping for that (the same default as a new element). Set the project setting to "none" to convert without it',
      );
    }
  }

  /** Nothing of the vendor namespaces may stay: what the rules did not know is reported and removed. */
  private sweep(): void {
    const root = this.doc.documentElement;
    for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
      if (!el.parentNode) continue;
      for (const attr of Array.from(el.attributes)) {
        if (attr.namespaceURI === XMLNS_NS) {
          if (isVendorNamespace(attr.value)) el.removeAttributeNode(attr);
        } else if (isVendorNamespace(attr.namespaceURI)) {
          this.drop(el, attr, 'dropped', REASONS.noEquivalent);
        }
      }
    }
    for (const el of Array.from(root.getElementsByTagName('*'))) {
      if (el.parentNode && isVendorNamespace(el.namespaceURI)) {
        this.recorder.entry(this.owner(el), 'dropped', `<${el.prefix}:${el.localName}>`, 'dropped', REASONS.noEquivalent);
        this.removeNode(el);
      }
    }
  }

  private declareNamespace(): void {
    const root = this.doc.documentElement;
    if (root.lookupNamespaceURI('activiti') !== ACTIVITI_NS) root.setAttributeNS(XMLNS_NS, 'xmlns:activiti', ACTIVITI_NS);
  }
}

/** Short text of a parameter for the report. */
export function summarize(param: Element): string {
  const script = param.getElementsByTagNameNS(CAMUNDA_NS, 'script')[0];
  if (script) return `script (${script.getAttribute('scriptFormat') ?? 'script'})`;
  if (Array.from(param.children).some((c) => c.localName === 'list')) return 'list';
  if (Array.from(param.children).some((c) => c.localName === 'map')) return 'map';
  const text = (param.textContent ?? '').trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text || '(empty)';
}

/** DMN FEEL type name to the variable type of the extensions file (as the decision picker does). */
export function feelToVariableType(feel: string): string {
  switch (feel.toLowerCase()) {
    case 'boolean': return 'boolean';
    case 'integer': case 'long': case 'number': case 'double': return 'bigdecimal';
    case 'date': return 'date';
    case 'datetime': case 'date and time': case 'dateandtime': return 'datetime';
    case 'string': return 'string';
    default: return 'json';
  }
}

export function convertCamundaBpmn(xml: string, options: ConvertOptions = {}): ConversionResult {
  const { doc, error } = parseXml(xml);
  const none = { found: false, zeebe: false, prefixes: [] as string[], attributes: 0, elements: 0, modeler: false };
  if (error) {
    const recorder = new Recorder(options.fileName ?? 'process.bpmn');
    return { converted: false, xml, report: recorder.report(), detection: { ...none, error } };
  }
  const detection = detectCamundaDocument(doc);
  if (!detection.found) return { converted: false, xml, report: new Recorder(options.fileName ?? 'process.bpmn').report(), detection };

  const existing = options.extensions ? parseExtensions(JSON.stringify(options.extensions), 'process') : emptyExtensionsFile((options.fileName ?? 'process').replace(/\.(bpmn20\.xml|bpmn|xml)$/i, ''));
  const converter = new Converter(doc, options, existing);
  if (detection.zeebe) {
    converter.recorder.general('This is a Camunda 8 (Zeebe) model. Its task definitions, input / output mappings, FEEL expressions and forms have no counterpart in Activiti, which runs Camunda 7 style models: only the BPMN structure was kept.');
  }
  converter.convert();
  let text = new XMLSerializer().serializeToString(doc);
  if (!text.startsWith('<?xml')) text = `<?xml version="1.0" encoding="UTF-8"?>\n${text}`;
  // an entry for each process, so that the file is complete (the export does the same)
  for (const process of Array.from(doc.getElementsByTagNameNS(BPMN_NS, 'process'))) {
    const id = process.getAttribute('id');
    if (id) existing.extensions[id] ??= emptyProcessExtension();
  }
  const order = new Map<string, number>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    const id = el.getAttribute('id');
    if (id && !order.has(id)) order.set(id, order.size);
  }
  return { converted: true, xml: text, extensions: existing, extensionsJson: serializeExtensions(existing), report: converter.recorder.report(order), detection };
}

