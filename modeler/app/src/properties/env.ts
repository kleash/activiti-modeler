import { AccessorError, type DiagramElement, type ElementRegistry, type ExtensionsStore, type ProjectCatalog, type PropertyAccessors, variableSuggestions, type VariableSuggestion } from '@activiti-modeler/bpmn-js-activiti';

import { blocksWrite, type Diagnostic } from './validation/types';

export interface EventBusLike {
  fire(type: string, data?: Record<string, unknown>): unknown;
  on(type: string, handler: (event: never) => void): void;
}

/** The panel's `debounceInput` service: wraps a commit function so that typing commits after a pause. */
export type Debounce = (fn: (...args: never[]) => unknown) => ((...args: never[]) => unknown) & { flush?: () => void; cancel?: () => void };

export interface TypingGuard {
  /** Records the text of a field when its diagnostic stops the write; true then. */
  refuses(text: string | undefined, diagnostic: Diagnostic | string | null | undefined): boolean;
  /** The check of the entry, applied to the refused text instead of the value of the model while the field still holds that text. */
  validator<T>(check: (value: string | undefined) => T): (value: string | undefined) => T;
  /** For the `onBlur` of the entry. */
  onBlur(event: FocusEvent): void;
}

/**
 * What the groups and entries need: the accessors (the only way the panel reads or writes the model), the diagram queries
 * for pickers and completion, and the state of the panel that is not part of the model.
 */
export class PanelEnv {
  /** Messages of writes the accessor refused, by entry id; shown under the field through the panel's diagnostics. */
  private readonly rejected = new Map<string, string>();
  /** Text typed into a field that was refused (an error diagnostic), by element and entry: see `typing`. */
  private readonly refusedText = new Map<string, { text: string | undefined; base: string | undefined }>();
  /** The choice made in a select that was refused (an error diagnostic), by element and entry: see `choosing`. */
  private readonly refusedChoice = new Map<string, { text: string | undefined; base: string | undefined }>();
  /** UI state that is not in the XML: the timer type chosen before a value exists, the event kind of a new listener row. */
  readonly transient = new Map<string, unknown>();

  constructor(
    readonly accessors: PropertyAccessors,
    readonly registry: ElementRegistry,
    readonly store: ExtensionsStore,
    readonly eventBus: EventBusLike,
    readonly debounce: Debounce,
    /** The connectors, DMN decisions and processes of the project (empty where the host did not fill it). */
    readonly catalog: ProjectCatalog,
  ) {}

  has(element: DiagramElement, key: string): boolean {
    return this.accessors.has(element, key);
  }

  get<T = unknown>(element: DiagramElement, key: string): T {
    return this.accessors.get<T>(element, key);
  }

  /** The root element (process or collaboration) of the diagram `element` is in: the owner of the definitions accessors. */
  rootOf(element: DiagramElement): DiagramElement {
    let current = element;
    while (current.parent) current = current.parent as DiagramElement;
    return current;
  }

  /** Re-renders the panel (the groups are built again from the model). */
  refresh(): void {
    this.eventBus.fire('propertiesPanel.providersChanged');
  }

  /**
   * Writes through the accessor. A value the accessor refuses (it validates more than a field can) is not written; its message is
   * shown under the field of `entryId` (through `propertiesPanel.setDiagnostics`) until the next write, selection or change.
   */
  write(element: DiagramElement, key: string, value: unknown, entryId: string = key): boolean {
    try {
      this.accessors.set(element, key, value);
      this.forget(entryId);
      return true;
    } catch (e) {
      if (!(e instanceof AccessorError)) throw e;
      this.rejected.set(entryId, e.message);
      this.publish();
      return false;
    }
  }

  /** Drops the message of a refused write (the user went on). */
  forget(entryId?: string): void {
    const had = entryId === undefined ? this.rejected.size > 0 : this.rejected.delete(entryId);
    if (entryId === undefined) this.rejected.clear();
    if (had) this.publish();
  }

  /**
   * The text-field entries of the panel validate the value of the model again whenever the panel is built again (a lint result, a
   * change of the project catalog), which replaces the message of a refused text that is still in the field with the message for
   * the value that was never replaced. This keeps the refused text for such a rebuild: the entry validates it again, until the
   * model changes, another element is selected or the field is left with the value of the model.
   * `committed` is the text of the model when the entry is built.
   */
  typing(element: DiagramElement, entryId: string, committed: string | undefined): TypingGuard {
    const key = `${element.id}:${entryId}`;
    return {
      ...refusal(this.refusedText, key, committed),
      onBlur: (event) => {
        if (!this.refusedText.has(key)) return;
        if ((event.target as HTMLInputElement | HTMLTextAreaElement).value.trim() === (committed ?? '')) {
          this.refusedText.delete(key);
          this.refresh();
        }
      },
    };
  }

  /** Drops the refused texts (another element is selected: its fields start from the model again). */
  forgetTyping(): void {
    this.refusedText.clear();
  }

  /**
   * The same for a select entry: the library validates the value of the model again whenever the entry is built again (its `validate`
   * is a new function after a lint result or a change of the catalog), which replaces the message of a refused choice with the message
   * for the value that was never replaced (none). A refused choice snaps back to the value of the model, so there is no text to keep:
   * the choice is kept until the model changes or another element is selected, like the message of a refused write.
   */
  choosing(element: DiagramElement, entryId: string, committed: string | undefined): Pick<TypingGuard, 'refuses' | 'validator'> {
    return refusal(this.refusedChoice, `${element.id}:${entryId}`, committed);
  }

  /** Drops the refused choices (the model changed or another element is selected). */
  forgetChoices(): void {
    this.refusedChoice.clear();
  }

  private publish(): void {
    const diagnostics: Record<string, Array<{ message: string; severity: 'error' }>> = {};
    for (const [id, message] of this.rejected) diagnostics[id] = [{ message, severity: 'error' }];
    this.eventBus.fire('propertiesPanel.setDiagnostics', { diagnostics });
  }

  variables(element: DiagramElement): VariableSuggestion[] {
    return variableSuggestions(this.registry, this.store, element);
  }

  transientKey(element: DiagramElement, name: string): string {
    return `${element.id}:${name}`;
  }
}

export { blocksWrite };

/** Keeps a value that was refused (an error diagnostic) in `store`, so that the entry validates it again while the model still holds `committed`. */
function refusal(store: Map<string, { text: string | undefined; base: string | undefined }>, key: string, committed: string | undefined): Pick<TypingGuard, 'refuses' | 'validator'> {
  return {
    refuses: (text, diagnostic) => {
      if (!blocksWrite(diagnostic)) {
        store.delete(key);
        return false;
      }
      store.set(key, { text, base: committed });
      return true;
    },
    validator: (check) => (value) => {
      const refused = store.get(key);
      return check(refused && refused.base === committed && value === committed ? refused.text : value);
    },
  };
}
