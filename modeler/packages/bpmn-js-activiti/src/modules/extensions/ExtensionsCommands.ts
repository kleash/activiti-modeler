import { cloneExtensions, readElementEntries, removeElementKey, renameElementKey, writeElementEntries, emptyProcessExtension, type ElementEntries, type ExtensionsFile } from '@activiti-modeler/activiti-project';

import type { ExtensionsStore, Mutation, MutationContext } from './ExtensionsStore';

interface CommandStackLike {
  registerHandler(command: string, handler: new (store: ExtensionsStore) => unknown): void;
}

/** Whole-document snapshots make revert and redo exact, whatever the mutation did. */
abstract class SnapshotHandler<C extends { before?: ExtensionsFile; after?: ExtensionsFile }> {
  static $inject = ['extensionsStore'];

  constructor(protected readonly store: ExtensionsStore) {}

  protected abstract label(context: C): string;
  protected abstract apply(file: ExtensionsFile, context: C): void;

  execute(context: C): void {
    if (context.before === undefined) {
      context.before = cloneExtensions(this.store.model as ExtensionsFile);
      const draft = cloneExtensions(context.before);
      this.apply(draft, context);
      context.after = draft;
    }
    // first run and redo alike apply the recorded result, so ids generated on the first run are stable
    this.store.replace(cloneExtensions(context.after as ExtensionsFile), this.label(context));
  }

  revert(context: C): void {
    this.store.replace(cloneExtensions(context.before as ExtensionsFile), `undo ${this.label(context)}`);
  }
}

interface UpdateContext {
  label: string;
  mutate: Mutation;
  newId(): string;
  before?: ExtensionsFile;
  after?: ExtensionsFile;
}

class UpdateExtensionsHandler extends SnapshotHandler<UpdateContext> {
  static override $inject = ['extensionsStore'];
  protected label(context: UpdateContext): string {
    return context.label;
  }
  protected apply(file: ExtensionsFile, context: UpdateContext): void {
    const mutationContext: MutationContext = { newId: context.newId };
    context.mutate(file, mutationContext);
  }
}

interface RenameElementContext {
  processId: string;
  oldId: string;
  newId: string;
  before?: ExtensionsFile;
  after?: ExtensionsFile;
}

class RenameElementHandler extends SnapshotHandler<RenameElementContext> {
  static override $inject = ['extensionsStore'];
  protected label(c: RenameElementContext): string {
    return `rename ${c.oldId} to ${c.newId}`;
  }
  protected apply(file: ExtensionsFile, c: RenameElementContext): void {
    const ext = file.extensions[c.processId];
    if (ext) renameElementKey(ext, c.oldId, c.newId);
  }
}

interface RenameProcessContext {
  oldId: string;
  newId: string;
  before?: ExtensionsFile;
  after?: ExtensionsFile;
}

class RenameProcessHandler extends SnapshotHandler<RenameProcessContext> {
  static override $inject = ['extensionsStore'];
  protected label(c: RenameProcessContext): string {
    return `rename process ${c.oldId} to ${c.newId}`;
  }
  protected apply(file: ExtensionsFile, c: RenameProcessContext): void {
    if (c.oldId === c.newId || !(c.oldId in file.extensions)) return;
    // keep the key position
    const rebuilt: ExtensionsFile['extensions'] = {};
    for (const [key, value] of Object.entries(file.extensions)) rebuilt[key === c.oldId ? c.newId : key] = value;
    file.extensions = rebuilt;
  }
}

interface RemoveElementContext {
  processId: string;
  elementId: string;
  before?: ExtensionsFile;
  after?: ExtensionsFile;
}

class RemoveElementHandler extends SnapshotHandler<RemoveElementContext> {
  static override $inject = ['extensionsStore'];
  protected label(c: RemoveElementContext): string {
    return `remove entries of ${c.elementId}`;
  }
  protected apply(file: ExtensionsFile, c: RemoveElementContext): void {
    const ext = file.extensions[c.processId];
    if (ext) removeElementKey(ext, c.elementId);
  }
}

export interface CopyPair {
  processId: string;
  toId: string;
  entries: ElementEntries;
}

interface CopyElementsContext {
  pairs: CopyPair[];
  before?: ExtensionsFile;
  after?: ExtensionsFile;
}

class CopyElementsHandler extends SnapshotHandler<CopyElementsContext> {
  static override $inject = ['extensionsStore'];
  protected label(): string {
    return 'copy entries of pasted elements';
  }
  protected apply(file: ExtensionsFile, c: CopyElementsContext): void {
    for (const pair of c.pairs) {
      const ext = (file.extensions[pair.processId] ??= emptyProcessExtension());
      writeElementEntries(ext, pair.toId, pair.entries);
    }
  }
}

export { readElementEntries };

/** Registers the `activiti.extensions.*` command handlers on the command stack. */
export class ExtensionsCommands {
  static $inject = ['commandStack'];

  constructor(commandStack: CommandStackLike) {
    commandStack.registerHandler('activiti.extensions.update', UpdateExtensionsHandler);
    commandStack.registerHandler('activiti.extensions.renameElement', RenameElementHandler);
    commandStack.registerHandler('activiti.extensions.renameProcess', RenameProcessHandler);
    commandStack.registerHandler('activiti.extensions.removeElement', RemoveElementHandler);
    commandStack.registerHandler('activiti.extensions.copyElements', CopyElementsHandler);
  }
}
