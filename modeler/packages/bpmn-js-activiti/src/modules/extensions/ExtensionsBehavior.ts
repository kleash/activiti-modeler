import { readElementEntries, type ElementEntries, keyedElementIds } from '@activiti-modeler/activiti-project';
import CommandInterceptor from 'diagram-js/lib/command/CommandInterceptor';

import { businessObjectOf, type CommandStack, type DiagramElement, type ModdleElement } from '../../types';
import type { CopyPair } from './ExtensionsCommands';
import { DEFAULT_MAPPING, MULTI_INSTANCE_USER_TASK_MAPPING, defaultMappingType, isMultiInstanceLoop, wantsDefaultMapping } from './defaultMappings';
import type { ExtensionsStore } from './ExtensionsStore';

interface EventBusLike {
  on(event: string, priority: number | ((event: never) => void), handler?: (event: never) => void): void;
}

/** Id of the process a business object belongs to (walks up through sub processes). */
export function processIdOf(bo: ModdleElement | undefined): string | undefined {
  for (let current: ModdleElement | undefined = bo; current; current = current.$parent) {
    if (current.$instanceOf('bpmn:Process')) return current.id;
    if (current.$instanceOf('bpmn:Participant')) {
      const ref = current.get('processRef') as ModdleElement | undefined;
      return ref?.id;
    }
  }
  return undefined;
}

interface CopiedEntries {
  /** old element id -> entries, as they were at copy time (survives edits and works across diagrams) */
  entries: Map<string, ElementEntries>;
}

/** Shared by every modeler on the page, so copy / paste also works between two open diagrams. */
const clipboard: CopiedEntries = { entries: new Map() };

/**
 * Keeps the extensions document consistent with the diagram (ADR 0006): renames keys when ids change, drops them when
 * elements are deleted, and carries them over when elements are pasted. Everything runs inside the triggering
 * command, so one undo reverts the diagram edit and the JSON edit together.
 */
export class ExtensionsBehavior extends CommandInterceptor {
  static override $inject = ['eventBus', 'commandStack', 'extensionsStore'];

  private readonly commandStack: CommandStack;
  private readonly store: ExtensionsStore;
  /** True while bpmn-js replaces a shape: it deletes the old one and gives the new one the old id back. */
  private replacing = 0;
  /** old id -> new element of the paste in progress */
  private pasteCache: Record<string, DiagramElement> | undefined;
  /**
   * Multi-instance user tasks whose mapping is the multi-instance default and has not been touched since the behaviour set it
   * (`processId/elementId`). Switching multi-instance off puts `MAP_ALL` back only for these, so a `MAP_ALL_OUTPUTS` the user chose is kept.
   */
  private readonly switchedByDefault = new Set<string>();

  constructor(eventBus: EventBusLike, commandStack: CommandStack, store: ExtensionsStore) {
    super(eventBus as never);
    this.commandStack = commandStack;
    this.store = store;

    // --- ids
    this.postExecuted(['element.updateProperties', 'element.updateModdleProperties'], (event: { context: Record<string, unknown> }) => this.onIdChange(event.context));

    // --- delete
    this.preExecute(['shape.delete', 'connection.delete'], (event: { context: Record<string, unknown> }) => {
      const element = (event.context['shape'] ?? event.context['connection']) as DiagramElement;
      event.context['activitiProcessId'] = processIdOf(element?.businessObject);
    });
    this.postExecuted(['shape.delete', 'connection.delete'], (event: { context: Record<string, unknown> }) => {
      if (this.replacing > 0) return;
      const element = (event.context['shape'] ?? event.context['connection']) as DiagramElement;
      const processId = event.context['activitiProcessId'] as string | undefined;
      if (!element || !processId) return;
      const ext = this.store.getProcess(processId);
      if (ext && keyedElementIds(ext).includes(element.id)) {
        this.commandStack.execute('activiti.extensions.removeElement', { processId, elementId: element.id });
      }
    });

    // --- replace keeps the entries (bpmn-js deletes the old shape, then renames the new one to the old id)
    this.preExecute('shape.replace', () => {
      this.replacing += 1;
    });
    this.postExecuted('shape.replace', 100, () => {
      this.replacing = Math.max(0, this.replacing - 1);
    });

    // --- default mappings (ADR 0006): created here, so one undo removes the element and its mapping together
    this.postExecuted('shape.create', (event: { context: { shape?: DiagramElement } }) => {
      // a replaced shape keeps the entries of the one it replaces, a pasted one gets the entries of its source
      if (this.replacing > 0 || this.pasteCache) return;
      if (event.context.shape) this.addDefaultMapping(event.context.shape);
    });
    // changing the type of a shape (task -> user task, none event -> message event) creates a new element of that type
    this.postExecuted('shape.replace', 50, (event: { context: { oldShape?: DiagramElement; newShape?: DiagramElement } }) => {
      const { oldShape, newShape } = event.context;
      if (!newShape || !oldShape || wantsDefaultMapping(oldShape.businessObject)) return;
      this.addDefaultMapping(newShape);
    });

    // --- turning multi-instance on or off on a user task switches its default mapping (one undo step with the change)
    this.postExecuted('element.updateProperties', (event: { context: { element?: DiagramElement; properties?: Record<string, unknown>; oldProperties?: Record<string, unknown> } }) => {
      const { element, properties, oldProperties } = event.context;
      if (!element || !properties || !('loopCharacteristics' in properties)) return;
      this.onLoopChange(element, isMultiInstanceLoop(oldProperties?.['loopCharacteristics'] as ModdleElement | undefined), isMultiInstanceLoop(properties['loopCharacteristics'] as ModdleElement | undefined));
    });
    // a mapping that was changed after the behaviour set it belongs to the user from then on
    eventBus.on('commandStack.changed', 1, (() => this.forgetTouched()) as never);

    // --- copy / paste
    let pending = new Map<string, ElementEntries>();
    eventBus.on('copyPaste.copyElement', 1, ((event: { element: DiagramElement }) => {
      const bo = event.element.businessObject;
      const processId = processIdOf(bo);
      const ext = processId ? this.store.getProcess(processId) : undefined;
      if (ext && bo?.id) {
        const entries = readElementEntries(ext, bo.id);
        if (Object.keys(entries).length > 0) pending.set(bo.id, entries);
      }
    }) as never);
    eventBus.on('copyPaste.elementsCopied', 1, (() => {
      clipboard.entries = pending;
      pending = new Map();
    }) as never);
    eventBus.on('copyPaste.pasteElement', 1, ((event: { cache: Record<string, DiagramElement> }) => {
      this.pasteCache = event.cache;
    }) as never);
    this.postExecuted('elements.create', (event: { context: { elements?: DiagramElement[] } }) => this.onPasted(event.context));
  }

  /** Gives a new user task, call activity or message catch event its default mapping (`MAP_ALL`, see `defaultMappingType`), unless it has a mapping or the setting is off. */
  private addDefaultMapping(shape: DiagramElement): void {
    if (this.store.defaultMappings !== 'mapAll' || shape.labelTarget || !shape.businessObject) return;
    if (!wantsDefaultMapping(shape.businessObject)) return;
    const processId = processIdOf(shape.businessObject);
    if (!processId || this.store.getProcess(processId)?.mappings[shape.id]) return;
    const mappingType = defaultMappingType(shape.businessObject);
    this.store.setMapping(processId, shape.id, { mappingType }, { declare: false });
    if (mappingType === MULTI_INSTANCE_USER_TASK_MAPPING) this.switchedByDefault.add(`${processId}/${shape.id}`);
  }

  /**
   * A user task became multi-instance, or stopped being one: its default mapping follows. Only a mapping that is exactly the default of the
   * old state is replaced, so a mapping the user chose is never overwritten. `MAP_ALL` is also what the user may have picked on the plain task,
   * but on a (parallel) multi-instance task it wedges the instance, so it is switched. On the way back `MAP_ALL` is restored only when the
   * behaviour had set the multi-instance default itself and nothing changed it since.
   */
  private onLoopChange(element: DiagramElement, wasMultiInstance: boolean, isMultiInstance: boolean): void {
    if (wasMultiInstance === isMultiInstance || this.store.defaultMappings !== 'mapAll' || element.labelTarget || !element.businessObject?.$instanceOf('bpmn:UserTask')) return;
    const processId = processIdOf(element.businessObject);
    const current = processId ? this.store.getProcess(processId)?.mappings[element.id] : undefined;
    if (!processId || !current) return;
    const key = `${processId}/${element.id}`;
    const exactly = (type: string): boolean => Object.keys(current).length === 1 && current.mappingType === type;
    if (isMultiInstance && exactly(DEFAULT_MAPPING)) {
      this.store.setMapping(processId, element.id, { mappingType: MULTI_INSTANCE_USER_TASK_MAPPING }, { declare: false });
      this.switchedByDefault.add(key);
    } else if (!isMultiInstance && exactly(MULTI_INSTANCE_USER_TASK_MAPPING) && this.switchedByDefault.has(key)) {
      this.store.setMapping(processId, element.id, { mappingType: DEFAULT_MAPPING }, { declare: false });
      this.switchedByDefault.delete(key);
    }
  }

  private forgetTouched(): void {
    for (const key of [...this.switchedByDefault]) {
      const slash = key.indexOf('/');
      const mapping = this.store.getProcess(key.slice(0, slash))?.mappings[key.slice(slash + 1)];
      if (!mapping || Object.keys(mapping).length !== 1 || mapping.mappingType !== MULTI_INSTANCE_USER_TASK_MAPPING) this.switchedByDefault.delete(key);
    }
  }

  private onIdChange(context: Record<string, unknown>): void {
    const properties = context['properties'] as Record<string, unknown> | undefined;
    if (!properties || !('id' in properties)) return;
    const oldProperties = (context['oldProperties'] ?? {}) as Record<string, unknown>;
    const oldId = oldProperties['id'] as string | undefined;
    const newId = properties['id'] as string | undefined;
    if (!oldId || !newId || oldId === newId) return;
    // updateModdleProperties changes a nested moddle element (a pool's process), updateProperties the element's own
    const changed = (context['moddleElement'] as ModdleElement | undefined) ?? businessObjectOf(context['element'] as DiagramElement);
    if (changed.$instanceOf('bpmn:Process')) {
      if (this.store.model.extensions[oldId]) this.commandStack.execute('activiti.extensions.renameProcess', { oldId, newId });
      return;
    }
    const processId = processIdOf(changed);
    if (!processId) return;
    const ext = this.store.getProcess(processId);
    if (ext && keyedElementIds(ext).includes(oldId)) {
      this.commandStack.execute('activiti.extensions.renameElement', { processId, oldId, newId });
    }
  }

  private onPasted(context: { elements?: DiagramElement[] }): void {
    const cache = this.pasteCache;
    this.pasteCache = undefined;
    if (!cache || clipboard.entries.size === 0) return;
    const created = new Set((context.elements ?? []).map((e) => e.id));
    const pairs: CopyPair[] = [];
    for (const [oldId, element] of Object.entries(cache)) {
      if (!created.has(element.id)) continue;
      const entries = clipboard.entries.get(oldId);
      const processId = processIdOf(element.businessObject);
      if (!entries || Object.keys(entries).length === 0 || !processId) continue;
      pairs.push({ processId, toId: element.id, entries });
    }
    if (pairs.length > 0) this.commandStack.execute('activiti.extensions.copyElements', { pairs });
  }
}
