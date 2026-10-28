/** @jsxImportSource @bpmn-io/properties-panel/preact */
import { useShowEntryEvent } from '@bpmn-io/properties-panel';
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';
import { useEffect, useMemo, useRef, useState } from '@bpmn-io/properties-panel/preact/hooks';

import { EntryLabel, EntryShell, useEntryDiagnostic, type Diagnostic } from './shared';

/** A field value as the accessors take it: literal text, or `{ expression }`. */
export type FieldValue = string | { expression: string } | undefined;

export interface FieldValueEntryProps {
  element: { id: string };
  id: string;
  label: ComponentChildren;
  getValue(element: unknown): FieldValue;
  setValue(value: FieldValue): void;
  debounce(fn: (...args: never[]) => unknown): ((...args: never[]) => unknown) & { flush?: () => void; cancel?: () => void };
  /** Suggested values (true / false, charset names). */
  suggestions?: readonly string[];
  placeholder?: string;
  tooltip?: ComponentChildren;
  description?: ComponentChildren;
  /** Extra validation of the text. */
  validate?(text: string | undefined): Diagnostic | undefined;
  /** The mode a new value starts in when its text has no `${`. */
  defaultMode?: 'string' | 'expression';
}

type Mode = 'string' | 'expression';

const textOf = (value: FieldValue): string => (value === undefined ? '' : typeof value === 'string' ? value : value.expression);
const modeOf = (value: FieldValue, fallback: Mode): Mode => (value === undefined ? fallback : typeof value === 'string' ? 'string' : 'expression');

/**
 * One `activiti:field` of a mail or shell task: a text and whether the engine reads it as a literal (`activiti:string`)
 * or evaluates it (`activiti:expression`). A literal with `${...}` in it is shown with a warning: it is never evaluated.
 */
export function FieldValueEntry(props: FieldValueEntryProps) {
  return <FieldValueBody key={props.element.id} {...props} />;
}

function FieldValueBody(props: FieldValueEntryProps) {
  const { id, element, label, getValue, setValue, suggestions, placeholder, defaultMode = 'string' } = props;
  const model = getValue(element);
  const [mode, setMode] = useState<Mode>(modeOf(model, defaultMode));
  const [text, setText] = useState(textOf(model));
  const ref = useShowEntryEvent(id);
  const latest = useRef({ mode, text, model });
  latest.current = { mode, text, model };
  /** The user picked the type himself: typing `${` no longer switches it. */
  const chosen = useRef(false);
  const modelJson = String(JSON.stringify(model));
  // what the model holds as far as this editor knows: what it read, or what it wrote last
  const expected = useRef(modelJson);

  // the model changed from outside (undo, redo): follow it; the result of our own write is already on screen
  useEffect(() => {
    if (modelJson === expected.current) return;
    expected.current = modelJson;
    setText(textOf(model));
    setMode(modeOf(model, defaultMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelJson]);

  const write = useMemo(() => {
    const run = (): void => {
      const { mode: m, text: t } = latest.current;
      const next: FieldValue = t === '' ? undefined : m === 'expression' ? { expression: t } : t;
      if (String(JSON.stringify(next)) === String(JSON.stringify(getValue(element)))) return;
      expected.current = String(JSON.stringify(next));
      setValue(next);
    };
    return Object.assign(props.debounce(run), { now: run });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.debounce]);

  const literalWithExpression = mode === 'string' && /[$#]\{/.test(text);
  const local = props.validate?.(text === '' ? undefined : text) ?? (literalWithExpression ? ({ severity: 'warning', message: 'This is a literal: ${...} in it is not evaluated. Switch to "Expression" to evaluate it.' } as Diagnostic) : undefined);
  const diagnostic = useEntryDiagnostic(id, local);
  const inputId = `bio-properties-panel-${id}`;
  const listId = suggestions ? `${inputId}-list` : undefined;
  return (
    <EntryShell id={id} element={element} diagnostic={diagnostic} description={props.description} className="activiti-field-value">
      <EntryLabel id={id} label={label} tooltip={props.tooltip} element={element} htmlFor={inputId} />
      <div class="activiti-field-value__inputs">
        <input
          ref={ref as never}
          id={inputId}
          type="text"
          class="bio-properties-panel-input"
          spellcheck={false}
          autocomplete="off"
          placeholder={placeholder}
          list={listId}
          value={text}
          onInput={(e) => {
            const value = (e.target as HTMLInputElement).value;
            latest.current = { ...latest.current, text: value };
            // a new field starts as an expression as soon as the text has one in it
            const nextMode: Mode = !chosen.current && model === undefined && /[$#]\{/.test(value) ? 'expression' : latest.current.mode;
            latest.current = { ...latest.current, mode: nextMode };
            setText(value);
            setMode(nextMode);
            write();
          }}
          onBlur={() => {
            write.cancel?.();
            write.now();
          }}
        />
        <select
          class="bio-properties-panel-input activiti-field-value__mode"
          aria-label={`${typeof label === 'string' ? label : id}: value type`}
          id={`${inputId}-mode`}
          data-entry-id={`${id}.mode`}
          value={mode}
          onInput={(e) => {
            const next = (e.target as HTMLSelectElement).value as Mode;
            chosen.current = true;
            latest.current = { ...latest.current, mode: next };
            setMode(next);
            write.cancel?.();
            write.now();
          }}
        >
          <option value="string">Text</option>
          <option value="expression">Expression</option>
        </select>
      </div>
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </EntryShell>
  );
}
