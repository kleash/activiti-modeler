import {
  cloneExtensions, declareOutputTargets, emptyExtensionsFile, emptyProcessExtension, type ConstantValue, type DeclareHints,
  type ExtensionsFile, type ProcessExtension, type ProcessVariablesMapping, parseExtensions, serializeExtensionsReport,
  unknownExtensionFields,
} from '@activiti-modeler/activiti-project';

import type { CommandStack } from '../../types';

interface EventBus {
  fire(type: string, data?: Record<string, unknown>): unknown;
  on(type: string, handler: (event: unknown) => void): void;
}

export const EXTENSIONS_CHANGED = 'activiti.extensions.changed';

/** What a mutation callback may use besides the file: a fresh id for declared properties. */
export interface MutationContext {
  newId(): string;
}

export type Mutation = (file: ExtensionsFile, context: MutationContext) => void;

/**
 * Mapping a new user task, call activity or message catch event gets (ADR 0006, "Default mappings"):
 * `mapAll` writes `mappingType: MAP_ALL` (`MAP_ALL_OUTPUTS` on a multi-instance user task), `none` writes nothing. Imported elements are never touched either way.
 */
export type DefaultMappings = 'mapAll' | 'none';

/** bpmn-js option `activitiExtensions`: `new BpmnModeler({ activitiExtensions: { defaultMappings: 'none' } })`. */
export interface ExtensionsConfig {
  defaultMappings?: DefaultMappings;
}

const defaultId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

/**
 * The per-process `-extensions.json` model of the open diagram (ADR 0006). The XML and this document share one undo
 * history: every change is a diagram-js command (`activiti.extensions.update` and friends), never a direct mutation.
 */
export class ExtensionsStore {
  static $inject = ['eventBus', 'commandStack', 'config.activitiExtensions'];

  private file: ExtensionsFile = emptyExtensionsFile('process');
  /** True while the document was not loaded from a file: its id and name then follow the export name. */
  private generated = true;
  private readonly eventBus: EventBus;
  private readonly commandStack: CommandStack;
  /** Source of ids for declared properties; replaceable for deterministic builds. */
  idGenerator: () => string = defaultId;
  /** Whether newly created user tasks, call activities and message catch events get their default mapping; settable at run time. */
  defaultMappings: DefaultMappings;

  constructor(eventBus: EventBus, commandStack: CommandStack, config?: ExtensionsConfig) {
    this.eventBus = eventBus;
    this.commandStack = commandStack;
    this.defaultMappings = config?.defaultMappings ?? 'mapAll';
    // a new diagram starts with a new document; `load` after the import supplies the file that belongs to it
    eventBus.on('import.parse.start', () => this.load(undefined));
  }

  // --- document ----------------------------------------------------------------------------------------------

  /** Replaces the document (after an import); clears nothing in the command stack, the caller does that. */
  load(source: ExtensionsFile | string | undefined, name = 'process'): void {
    this.generated = source === undefined;
    this.file = typeof source === 'string' ? parseExtensions(source, name) : source ? source : emptyExtensionsFile(name);
    this.changed('load');
  }

  /** Read-only access to the live document. Mutate through commands only. */
  get model(): Readonly<ExtensionsFile> {
    return this.file;
  }

  getProcess(processId: string): Readonly<ProcessExtension> | undefined {
    return this.file.extensions[processId];
  }

  /**
   * Document with an entry for each of `processIds`, serialised for `<name>-extensions.json`. Only fields the Activiti
   * 9.0.0 runtime knows are written; `dropped` lists the JSON paths of the others (from an imported file).
   */
  serializeWithReport(processIds: readonly string[] = [], name?: string): { json: string; dropped: string[] } {
    const copy = cloneExtensions(this.file);
    if (name && this.generated) copy.id = `process-${name}`;
    for (const id of processIds) copy.extensions[id] ??= emptyProcessExtension();
    const { text, dropped } = serializeExtensionsReport(copy);
    return { json: text, dropped };
  }

  serialize(processIds: readonly string[] = [], name?: string): string {
    return this.serializeWithReport(processIds, name).json;
  }

  /** JSON paths of the loaded document's fields that the runtime does not know (reported on import, dropped on export). */
  unknownFields(): string[] {
    return unknownExtensionFields(this.file);
  }

  /** Used by the command handlers only. */
  replace(file: ExtensionsFile, reason: string): void {
    this.file = file;
    this.changed(reason);
  }

  private changed(reason: string): void {
    this.eventBus.fire(EXTENSIONS_CHANGED, { reason });
  }

  // --- commands ----------------------------------------------------------------------------------------------

  /** Applies `mutate` as one undoable command. */
  update(label: string, mutate: Mutation): void {
    this.commandStack.execute('activiti.extensions.update', { label, mutate, newId: () => this.idGenerator() });
  }

  /** Sets (or, with undefined, removes) the input / output mapping of an element and declares its output targets. */
  setMapping(processId: string, elementId: string, mapping: ProcessVariablesMapping | undefined, options: { declare?: boolean; hints?: DeclareHints } = {}): void {
    this.update(`set mapping of ${elementId}`, (file, ctx) => {
      const ext = (file.extensions[processId] ??= emptyProcessExtension());
      if (mapping === undefined) {
        delete ext.mappings[elementId];
        return;
      }
      ext.mappings[elementId] = mapping;
      if (options.declare !== false) declareOutputTargets(ext, mapping, () => ctx.newId(), options.hints);
    });
  }

  /** Sets (or removes) the constants of an element. */
  setConstants(processId: string, elementId: string, constants: Record<string, ConstantValue> | undefined): void {
    this.update(`set constants of ${elementId}`, (file) => {
      const ext = (file.extensions[processId] ??= emptyProcessExtension());
      if (constants === undefined || Object.keys(constants).length === 0) delete ext.constants[elementId];
      else ext.constants[elementId] = constants;
    });
  }

  /** Replaces the declared process variables, keeping ids of variables that stay. */
  setProperties(processId: string, properties: ProcessExtension['properties']): void {
    this.update('set process variables', (file) => {
      (file.extensions[processId] ??= emptyProcessExtension()).properties = properties;
    });
  }
}
