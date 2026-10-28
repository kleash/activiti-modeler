/** @jsxImportSource @bpmn-io/properties-panel/preact */
import { useShowEntryEvent } from '@bpmn-io/properties-panel';
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';
import { useEffect, useMemo, useRef, useState } from '@bpmn-io/properties-panel/preact/hooks';

import { EntryLabel, EntryShell, type Diagnostic } from './shared';

export type Row = Record<string, string | boolean | undefined>;

export interface RowColumn {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'check' | 'area';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string | ((row: Row) => string | undefined);
  /** A hint under the cell. */
  hint?: string | ((row: Row) => string | undefined);
  /** Only shown when this returns true (e.g. the value of a field kind). */
  when?(row: Row): boolean;
  /** Message under the cell for this value; an error holds the row back from the model like a missing value does. `rows` are all the rows of the list. */
  validate?(value: string | undefined, row: Row, rows: Row[]): Diagnostic | undefined;
  /** Names the user can pick or type (a `datalist` under the text field). */
  suggest?(row: Row): string[];
  /** Shown only after "More fields" is clicked (or when the row has a value there). */
  advanced?: boolean;
}

export interface RowsEntryProps {
  element: { id: string };
  id: string;
  label: ComponentChildren;
  /** The rows of the model, as the accessor returns them. */
  rows: Row[];
  columns: RowColumn[];
  /** A new row; it stays in the panel until `missing` says nothing is missing. */
  blank(): Row;
  /** What a row still needs before it can be written to the model, or undefined when it is complete. `rows` are all the rows of the list. */
  missing(row: Row, rows: Row[]): string | undefined;
  /** Writes the complete rows to the model through the accessor. */
  commit(rows: Row[]): void;
  debounce(fn: (...args: never[]) => unknown): ((...args: never[]) => unknown) & { flush?: () => void; cancel?: () => void };
  addLabel?: string;
  /** Rows can be moved up and down (when the order matters). */
  reorder?: boolean;
  tooltip?: ComponentChildren;
  description?: ComponentChildren;
  /** The label of a row, e.g. its name; shown above its cells. */
  rowTitle?(row: Row, index: number): string;
  /** When it returns a message, removing that row first asks to confirm it (the message is shown with "Delete anyway" and "Keep"). */
  confirmRemove?(row: Row): string | undefined;
}

/** Rows compared by what they say: empty text, false and undefined are the same (the model does not store them); keys that start with "_" are the editor's own. */
const canon = (rows: Row[]): string => JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !k.startsWith('_') && v !== undefined && v !== '' && v !== false))));

let nextRowKey = 1;
/** Gives every row a key of its own (`_k`): the row stays the same row while its fields are edited, so that an incomplete edit falls back to the row's last complete version. */
const withKeys = (rows: Row[]): Row[] => rows.map((r) => (r['_k'] === undefined ? { ...r, _k: `k${nextRowKey++}` } : r));

/**
 * A small editor for a list of structured values (fields, parameters, exception mappings, form properties). Rows that miss
 * a required value stay in the panel as drafts and reach the XML as soon as they are complete; the rows keep their order.
 */
export function RowsEntry(props: RowsEntryProps) {
  return <RowsBody key={props.element.id} {...props} />;
}

function RowsBody(props: RowsEntryProps) {
  const { id, element, label, rows: modelRows, columns, blank, missing, addLabel = 'Add', reorder = false, rowTitle } = props;
  const [local, setLocal] = useState<Row[]>(() => withKeys(modelRows));
  const localRef = useRef(local);
  localRef.current = local;
  // what the model holds, as far as this editor knows: the rows it read, or the rows it wrote last
  const expected = useRef(canon(modelRows));
  // the rows of the model at the last render: a render with the same props is no news (the panel passes the model of its last render, which can lag behind a write)
  const lastModel = useRef(canon(modelRows));

  // another source changed the model (undo, redo, another field): take its rows; our own writes keep the drafts
  // runs after every render on purpose: it only sets state when the props changed to something this editor did not write, so it settles at once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const model = canon(modelRows);
    if (model === lastModel.current) return;
    lastModel.current = model;
    if (model === expected.current) return;
    expected.current = model;
    const adopted = withKeys(modelRows);
    committed.current = adopted;
    setLocal(adopted);
  });

  // the rows as last written (or taken from the model): the versions an incomplete row falls back to
  const committed = useRef<Row[]>(local);
  // the write is made once, so it calls the props of the last render: the commit of a list item (the fields of a listener) writes the
  // item as it is now, and one of an earlier render would put back what the item held then (its event and class before they were set)
  const latest = useRef(props);
  latest.current = props;

  const write = useMemo(() => {
    const run = (): void => {
      const { missing: incomplete, commit: store } = latest.current;
      // an incomplete row keeps its last complete version in the model while it is being fixed; a new row that was never complete is not written
      const previous = new Map(committed.current.map((r) => [r['_k'], r]));
      const complete = localRef.current.flatMap((r) => {
        if (incomplete(r, localRef.current) === undefined) return [r];
        const old = previous.get(r['_k']);
        return old ? [old] : [];
      });
      if (canon(complete) === expected.current) return;
      expected.current = canon(complete);
      committed.current = complete;
      store(complete);
    };
    return Object.assign(props.debounce(run), { now: run });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.debounce]);

  const change = (index: number, patch: Row, immediately: boolean): void => {
    const next = localRef.current.map((r, i) => (i === index ? { ...r, ...patch } : r));
    localRef.current = next;
    setLocal(next);
    if (immediately) {
      write.cancel?.();
      write.now();
    } else write();
  };
  const [confirming, setConfirming] = useState<number | undefined>(undefined);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const remove = (index: number): void => {
    setConfirming(undefined);
    const next = localRef.current.filter((_, i) => i !== index);
    localRef.current = next;
    setLocal(next);
    write.cancel?.();
    write.now();
  };
  const move = (index: number, delta: -1 | 1): void => {
    const next = localRef.current.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    localRef.current = next;
    setLocal(next);
    write.cancel?.();
    write.now();
  };
  const add = (): void => {
    const next = [...localRef.current, ...withKeys([blank()])];
    localRef.current = next;
    setLocal(next);
    // a blank row that is already complete (all defaults) is written right away
    write.cancel?.();
    write.now();
  };

  return (
    <EntryShell id={id} element={element} description={props.description} className="activiti-rows">
      <div class="activiti-rows__header">
        <EntryLabel id={id} label={label} tooltip={props.tooltip} element={element} htmlFor={`bio-properties-panel-${id}-add`} />
        <button type="button" id={`bio-properties-panel-${id}-add`} class="activiti-tool" onClick={add} title={addLabel} data-testid={`${id}-add`}>
          + {addLabel}
        </button>
      </div>
      {local.map((row, index) => {
        const problem = missing(row, local);
        const confirmation = confirming === index ? props.confirmRemove?.(row) : undefined;
        const hasAdvanced = columns.some((c) => c.advanced);
        const showAdvanced = expanded.has(index) || columns.some((c) => c.advanced && row[c.key] !== undefined && row[c.key] !== '' && row[c.key] !== false);
        return (
          <div class="activiti-row" key={index} data-entry-id={`${id}[${index}]`}>
            <div class="activiti-row__title">
              <span>{rowTitle?.(row, index) || `#${index + 1}`}</span>
              <span class="activiti-row__buttons">
                {reorder ? (
                  <>
                    <button type="button" class="activiti-tool" disabled={index === 0} title="Move up" aria-label="Move up" onClick={() => move(index, -1)}>
                      ↑
                    </button>
                    <button type="button" class="activiti-tool" disabled={index === local.length - 1} title="Move down" aria-label="Move down" onClick={() => move(index, 1)}>
                      ↓
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  class="activiti-tool activiti-tool--danger"
                  title="Remove"
                  aria-label="Remove"
                  data-testid={`${id}[${index}]-remove`}
                  onClick={() => (props.confirmRemove?.(row) ? setConfirming(index) : remove(index))}
                >
                  ×
                </button>
              </span>
            </div>
            {confirmation ? (
              <div class="bio-properties-panel-warning activiti-row__confirm" role="alert" data-entry-id={`${id}[${index}].confirm`}>
                <span>{confirmation}</span>{' '}
                <button type="button" class="activiti-tool activiti-tool--danger" data-testid={`${id}[${index}]-remove-anyway`} onClick={() => remove(index)}>
                  Delete anyway
                </button>{' '}
                <button type="button" class="activiti-tool" data-testid={`${id}[${index}]-keep`} onClick={() => setConfirming(undefined)}>
                  Keep
                </button>
              </div>
            ) : null}
            {columns
              .filter((c) => (!c.when || c.when(row)) && (!c.advanced || showAdvanced))
              .map((column) => (
                <Cell key={column.key} id={`${id}[${index}].${column.key}`} element={element} column={column} row={row} rows={local} onChange={(patch, immediately) => change(index, patch, immediately)} onBlur={() => write.flush?.()} />
              ))}
            {hasAdvanced && !showAdvanced ? (
              <button type="button" class="activiti-tool activiti-row__more" data-testid={`${id}[${index}]-more`} onClick={() => setExpanded(new Set([...expanded, index]))}>
                More fields
              </button>
            ) : null}
            {problem ? <div class="bio-properties-panel-warning activiti-row__missing">{problem} (not saved yet)</div> : null}
          </div>
        );
      })}
    </EntryShell>
  );
}

interface CellProps {
  id: string;
  element: unknown;
  column: RowColumn;
  row: Row;
  rows: Row[];
  onChange(patch: Row, immediately: boolean): void;
  onBlur(): void;
}

function Cell({ id, element, column, row, rows, onChange, onBlur }: CellProps) {
  const ref = useShowEntryEvent(id);
  const value = row[column.key];
  const text = typeof value === 'string' ? value : '';
  const inputId = `bio-properties-panel-${id}`;
  const diagnostic = column.validate?.(text === '' ? undefined : text, row, rows);
  const placeholder = typeof column.placeholder === 'function' ? column.placeholder(row) : column.placeholder;
  const hint = typeof column.hint === 'function' ? column.hint(row) : column.hint;
  const suggestions = column.suggest?.(row) ?? [];
  const listId = suggestions.length > 0 ? `${inputId}-list` : undefined;
  if (column.kind === 'check') {
    return (
      <div class="bio-properties-panel-entry bio-properties-panel-checkbox-entry" data-entry-id={id}>
        <div class="bio-properties-panel-checkbox">
          <input ref={ref as never} id={inputId} type="checkbox" class="bio-properties-panel-input" checked={value === true || value === 'true'} onInput={(e) => onChange({ [column.key]: (e.target as HTMLInputElement).checked }, true)} />
          <label for={inputId} class="bio-properties-panel-label">
            {column.label}
          </label>
        </div>
      </div>
    );
  }
  return (
    <div class={`bio-properties-panel-entry ${diagnostic?.severity === 'error' ? 'has-error' : diagnostic?.severity === 'warning' ? 'has-warning' : ''}`} data-entry-id={id}>
      <EntryLabel id={id} label={column.label} element={element} htmlFor={inputId} />
      {column.kind === 'select' ? (
        <select ref={ref as never} id={inputId} class="bio-properties-panel-input" value={text} onInput={(e) => onChange({ [column.key]: (e.target as HTMLSelectElement).value }, true)}>
          {(column.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : column.kind === 'area' ? (
        <textarea
          ref={ref as never}
          id={inputId}
          class="bio-properties-panel-input"
          spellcheck={false}
          rows={3}
          placeholder={placeholder}
          value={text}
          onInput={(e) => onChange({ [column.key]: (e.target as HTMLTextAreaElement).value }, false)}
          onBlur={onBlur}
        />
      ) : (
        <>
          <input
            ref={ref as never}
            id={inputId}
            type="text"
            class="bio-properties-panel-input"
            spellcheck={false}
            autocomplete="off"
            list={listId}
            placeholder={placeholder}
            value={text}
            onInput={(e) => onChange({ [column.key]: (e.target as HTMLInputElement).value }, false)}
            onBlur={onBlur}
          />
          {listId ? (
            <datalist id={listId} data-suggestions-for={id}>
              {suggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
      {diagnostic ? <div class={`bio-properties-panel-${diagnostic.severity}`}><span class="bio-properties-panel-error-message bio-properties-panel-diagnostic-message">{diagnostic.message}</span></div> : null}
      {hint ? <div class="bio-properties-panel-description">{hint}</div> : null}
    </div>
  );
}
