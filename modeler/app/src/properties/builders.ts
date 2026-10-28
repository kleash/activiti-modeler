import {
  SelectEntry, TextAreaEntry, TextFieldEntry, isCheckboxEntryEdited, isSelectEntryEdited, isTextAreaEntryEdited, isTextFieldEntryEdited,
} from '@bpmn-io/properties-panel';
import type { ComponentChildren, VNode } from '@bpmn-io/properties-panel/preact';
import type { DiagramElement } from '@activiti-modeler/bpmn-js-activiti';

import { CheckEntry } from './components/CheckEntry';
import { ActionEntry, type ActionButton } from './components/ActionEntry';
import { FieldValueEntry, type FieldValue } from './components/FieldValueEntry';
import { InfoEntry } from './components/InfoEntry';
import { JuelEntry, syntaxDiagnostic } from './components/JuelEntry';
import { RowsEntry, type Row, type RowColumn } from './components/RowsEntry';
import type { PanelEnv } from './env';
import { docsLinkFor, helpTooltip } from './help';
import { blocksWrite, type Diagnostic } from './validation/types';

/** An entry or group as the properties panel takes it: a plain object with a `component`. */
export type Definition = Record<string, unknown> & { id: string };

export interface FieldSpec {
  /** Accessor key; the entry id is the key unless `id` says otherwise. */
  key: string;
  id?: string;
  label: string;
  /** The key into HELP for the tooltip (default: the entry id, then the key). */
  help?: string;
  description?: ComponentChildren;
  placeholder?: string;
  disabled?: boolean;
  /** Extra checks; an error stops the write, a warning or info is shown under the field. */
  validate?(value: string | undefined): Diagnostic | undefined;
  /** Accessor value to the text of the field, and back. */
  read?(raw: unknown): string | undefined;
  write?(text: string | undefined): unknown;
}

export interface RawSpec {
  /** Entry id (e.g. `definitions.messages[0].name`). */
  id: string;
  label: string;
  /** The key into HELP for the tooltip (default: the id). */
  help?: string;
  description?: ComponentChildren;
  placeholder?: string;
  disabled?: boolean;
  /** The current text. */
  value: string | undefined;
  /** Writes the new text (undefined: cleared); returns nothing; a refusal is reported by `env.write`. */
  commit(value: string | undefined): void;
  validate?(value: string | undefined): Diagnostic | undefined;
}

export class EntryBuilder {
  constructor(
    readonly env: PanelEnv,
    readonly element: DiagramElement,
  ) {}

  /** Entry ids default to the accessor key. */
  private idOf(spec: { key: string; id?: string }): string {
    return spec.id ?? spec.key;
  }

  private tooltipFor(spec: { key: string; id?: string; help?: string }): VNode | undefined {
    return helpTooltip(spec.help ?? this.idOf(spec)) ?? helpTooltip(spec.key);
  }

  /** The text shown for the accessor's value. */
  private read(spec: FieldSpec): string | undefined {
    const raw = this.env.get(this.element, spec.key);
    return spec.read ? spec.read(raw) : (raw as string | undefined);
  }

  private validator(spec: FieldSpec): (value: string | undefined) => Diagnostic | undefined {
    return (value) => spec.validate?.(value);
  }

  private setter(spec: FieldSpec): (value: string | undefined, error?: Diagnostic | string | null) => void {
    const id = this.idOf(spec);
    return (value, error) => {
      if (blocksWrite(error)) return;
      this.env.write(this.element, spec.key, spec.write ? spec.write(value) : value, id);
    };
  }

  /** A text field that is not backed by one accessor key on its own: an item of a list, a part of a value. */
  textRaw(spec: RawSpec & { rows?: number; multiline?: boolean }): Definition {
    const typing = this.env.typing(this.element, spec.id, spec.value);
    return {
      id: spec.id,
      component: spec.multiline ? TextAreaEntry : TextFieldEntry,
      isEdited: spec.multiline ? isTextAreaEntryEdited : isTextFieldEntryEdited,
      label: spec.label,
      getValue: () => spec.value,
      setValue: (value: string | undefined, error?: Diagnostic | string | null) => {
        if (!typing.refuses(value, error)) spec.commit(value);
      },
      validate: typing.validator((value) => spec.validate?.(value)),
      onBlur: typing.onBlur,
      debounce: this.env.debounce,
      description: spec.description,
      placeholder: spec.placeholder,
      disabled: spec.disabled,
      rows: spec.rows,
      tooltip: helpTooltip(spec.help ?? spec.id),
    };
  }

  selectRaw(spec: Omit<RawSpec, 'placeholder'> & { options: Array<{ value: string; label: string; disabled?: boolean }> }): Definition {
    const current = spec.value ?? '';
    const options = spec.options.some((o) => o.value === current) ? spec.options : [...spec.options, { value: current, label: `${current} (not offered)` }];
    const choosing = this.env.choosing(this.element, spec.id, current);
    return {
      id: spec.id,
      component: SelectEntry,
      isEdited: isSelectEntryEdited,
      label: spec.label,
      getValue: () => current,
      setValue: (value: string | undefined, error?: Diagnostic | string | null) => {
        if (!choosing.refuses(value, error)) spec.commit(value === '' ? undefined : value);
      },
      getOptions: () => options,
      validate: choosing.validator((value: string | undefined) => spec.validate?.(value === '' ? undefined : value)),
      description: spec.description,
      disabled: spec.disabled,
      tooltip: helpTooltip(spec.help ?? spec.id),
    };
  }

  checkRaw(spec: Omit<RawSpec, 'placeholder' | 'value' | 'commit' | 'validate'> & { checked: boolean; commit(checked: boolean): void }): Definition {
    return {
      id: spec.id,
      component: CheckEntry,
      isEdited: isCheckboxEntryEdited,
      label: spec.label,
      getValue: () => spec.checked,
      setValue: (checked: boolean) => spec.commit(checked),
      description: spec.description,
      disabled: spec.disabled,
      tooltip: helpTooltip(spec.help ?? spec.id),
    };
  }

  text(spec: FieldSpec): Definition {
    const id = this.idOf(spec);
    const typing = this.env.typing(this.element, id, this.read(spec));
    const set = this.setter(spec);
    return {
      id,
      component: TextFieldEntry,
      isEdited: isTextFieldEntryEdited,
      label: spec.label,
      getValue: () => this.read(spec),
      setValue: (value: string | undefined, error?: Diagnostic | string | null) => {
        if (!typing.refuses(value, error)) set(value, error);
      },
      validate: typing.validator(this.validator(spec)),
      onBlur: typing.onBlur,
      debounce: this.env.debounce,
      description: spec.description,
      placeholder: spec.placeholder,
      disabled: spec.disabled,
      tooltip: this.tooltipFor(spec),
    };
  }

  area(spec: FieldSpec & { rows?: number }): Definition {
    return { ...this.text(spec), component: TextAreaEntry, isEdited: isTextAreaEntryEdited, rows: spec.rows ?? 4, monospace: false };
  }

  select(spec: FieldSpec & { options: Array<{ value: string; label: string; disabled?: boolean }> }): Definition {
    const id = this.idOf(spec);
    // a value the list does not know (an imported attribute) stays visible and selected
    const current = this.read(spec) ?? '';
    const options = spec.options.some((o) => o.value === current) ? spec.options : [...spec.options, { value: current, label: `${current} (not offered)` }];
    const choosing = this.env.choosing(this.element, id, current);
    return {
      id,
      component: SelectEntry,
      isEdited: isSelectEntryEdited,
      label: spec.label,
      getValue: () => this.read(spec) ?? '',
      setValue: (value: string | undefined, error?: Diagnostic | null) => {
        if (!choosing.refuses(value, error)) this.setter(spec)(value === '' ? undefined : value, error);
      },
      getOptions: () => options,
      validate: choosing.validator(this.validator({ ...spec, validate: spec.validate })),
      description: spec.description,
      disabled: spec.disabled,
      tooltip: this.tooltipFor(spec),
    };
  }

  check(spec: Omit<FieldSpec, 'read' | 'write' | 'validate' | 'placeholder'> & { read?(raw: unknown): boolean; write?(checked: boolean): unknown }): Definition {
    const id = this.idOf(spec);
    return {
      id,
      component: CheckEntry,
      isEdited: isCheckboxEntryEdited,
      label: spec.label,
      getValue: () => (spec.read ? spec.read(this.env.get(this.element, spec.key)) : this.env.get(this.element, spec.key) === true),
      setValue: (checked: boolean) => void this.env.write(this.element, spec.key, spec.write ? spec.write(checked) : checked, id),
      description: spec.description,
      disabled: spec.disabled,
      tooltip: this.tooltipFor(spec),
    };
  }

  /** An expression field (CodeMirror): `mode` says whether it is a condition, any expression text or script code. */
  juel(spec: FieldSpec & { mode?: 'expression' | 'condition' | 'block'; language?: 'juel' | 'plain'; rows?: number }): Definition {
    const id = this.idOf(spec);
    const mode = spec.mode ?? 'expression';
    const language = spec.language ?? 'juel';
    return {
      id,
      component: JuelEntry,
      label: spec.label,
      getValue: () => this.read(spec),
      setValue: this.setter(spec),
      validate: (value: string | undefined) => spec.validate?.(value) ?? syntaxDiagnostic(value, mode, language),
      debounce: this.env.debounce,
      variables: () => this.env.variables(this.element),
      diagramElement: this.element,
      mode,
      language,
      rows: spec.rows ?? 1,
      description: spec.description,
      placeholder: spec.placeholder,
      disabled: spec.disabled,
      tooltip: this.tooltipFor(spec),
    };
  }

  /** An expression field that is not backed by one accessor key (an item of a list). */
  juelRaw(spec: RawSpec & { mode?: 'expression' | 'condition' | 'block'; requiredMessage?: string }): Definition {
    const mode = spec.mode ?? 'expression';
    return {
      id: spec.id,
      component: JuelEntry,
      label: spec.label,
      getValue: () => spec.value,
      setValue: (value: string | undefined, error?: Diagnostic | string | null) => {
        if (!blocksWrite(error)) spec.commit(value);
      },
      validate: (value: string | undefined) => (value || !spec.requiredMessage ? undefined : { severity: 'warning', message: spec.requiredMessage }) ?? spec.validate?.(value) ?? syntaxDiagnostic(value, mode, 'juel'),
      debounce: this.env.debounce,
      variables: () => this.env.variables(this.element),
      diagramElement: this.element,
      mode,
      language: 'juel',
      rows: 1,
      description: spec.description,
      placeholder: spec.placeholder,
      disabled: spec.disabled,
      tooltip: helpTooltip(spec.help ?? spec.id),
    };
  }

  /** A mail or shell field: text plus text-or-expression. */
  fieldValue(spec: { key: string; label: string; help?: string; placeholder?: string; suggestions?: readonly string[]; defaultMode?: 'string' | 'expression'; description?: ComponentChildren; validate?(text: string | undefined): Diagnostic | undefined }): Definition {
    const id = spec.key;
    return {
      id,
      component: FieldValueEntry,
      label: spec.label,
      getValue: () => this.env.get<FieldValue>(this.element, spec.key),
      setValue: (value: FieldValue) => void this.env.write(this.element, spec.key, value, id),
      debounce: this.env.debounce,
      suggestions: spec.suggestions,
      placeholder: spec.placeholder,
      defaultMode: spec.defaultMode,
      description: spec.description,
      validate: spec.validate,
      tooltip: this.tooltipFor(spec),
    };
  }

  /** A hint inside a group; `docs` is the key into HELP whose page the link goes to. */
  info(id: string, text: ComponentChildren, severity: 'info' | 'warning' = 'info', docs?: string): Definition {
    return { id, component: InfoEntry, text, severity, docs: docs ? docsLinkFor(docs) : undefined };
  }

  /** A note with buttons (the template header, the actions of the decision group). */
  action(spec: { id: string; text?: ComponentChildren; severity?: 'info' | 'warning'; buttons: ActionButton[]; docs?: string }): Definition {
    return { id: spec.id, component: ActionEntry, text: spec.text, severity: spec.severity, buttons: spec.buttons, docs: spec.docs ? docsLinkFor(spec.docs) : undefined };
  }

  /** A list of structured rows edited in place; the rows are given and written as they are (an item of a list, a part of a value). */
  rowsRaw(spec: {
    id: string;
    label: string;
    help?: string;
    rows: Row[];
    columns: RowColumn[];
    blank(): Row;
    missing(row: Row, rows: Row[]): string | undefined;
    commit(rows: Row[]): void;
    addLabel?: string;
    reorder?: boolean;
    description?: ComponentChildren;
    rowTitle?(row: Row, index: number): string;
    confirmRemove?(row: Row): string | undefined;
  }): Definition {
    return {
      id: spec.id,
      component: RowsEntry,
      label: spec.label,
      rows: spec.rows,
      columns: spec.columns,
      blank: spec.blank,
      missing: spec.missing,
      commit: spec.commit,
      debounce: this.env.debounce,
      addLabel: spec.addLabel,
      reorder: spec.reorder,
      description: spec.description,
      rowTitle: spec.rowTitle,
      confirmRemove: spec.confirmRemove,
      tooltip: helpTooltip(spec.help ?? spec.id),
    };
  }

  /** A list of structured rows backed by one accessor key (fields, parameters, mappings). */
  rows<T>(spec: {
    key: string;
    id?: string;
    label: string;
    help?: string;
    columns: RowColumn[];
    toRow(value: T): Row;
    fromRow(row: Row): T;
    blank(): Row;
    missing(row: Row): string | undefined;
    addLabel?: string;
    reorder?: boolean;
    description?: ComponentChildren;
    rowTitle?(row: Row, index: number): string;
  }): Definition {
    const id = this.idOf(spec);
    return this.rowsRaw({
      ...spec,
      id,
      help: spec.help ?? id,
      rows: (this.env.get<T[]>(this.element, spec.key) ?? []).map(spec.toRow),
      commit: (rows) => void this.env.write(this.element, spec.key, rows.map(spec.fromRow), id),
    });
  }
}

export interface GroupSpec {
  id: string;
  label: string;
  entries: Definition[];
  /** Groups open when selected only if the user opened them before; this opens a group the first time. */
  shouldOpen?: boolean;
}

/** A collapsible group of entries; undefined when it has none, so a group never shows up empty. */
export function group(spec: GroupSpec): Definition | undefined {
  if (spec.entries.length === 0) return undefined;
  return { id: spec.id, label: spec.label, entries: spec.entries, shouldOpen: spec.shouldOpen ?? false, tooltip: helpTooltip(spec.id) };
}
