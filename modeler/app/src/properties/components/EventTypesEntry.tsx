/** @jsxImportSource @bpmn-io/properties-panel/preact */
import { useShowEntryEvent } from '@bpmn-io/properties-panel';
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';
import { useEffect, useMemo, useRef, useState } from '@bpmn-io/properties-panel/preact/hooks';

import { EntryLabel, EntryShell, useEntryDiagnostic, type Diagnostic } from './shared';

/** The `ActivitiEventType` constants of Activiti 9.0.0 (`activiti-engine`). */
export const ACTIVITI_EVENT_TYPES: readonly string[] = [
  'ENTITY_CREATED', 'ENTITY_INITIALIZED', 'ENTITY_UPDATED', 'ENTITY_DELETED', 'ENTITY_SUSPENDED', 'ENTITY_ACTIVATED', 'TIMER_SCHEDULED', 'TIMER_FIRED',
  'JOB_CANCELED', 'JOB_EXECUTION_SUCCESS', 'JOB_EXECUTION_FAILURE', 'JOB_RETRIES_DECREMENTED', 'CUSTOM', 'ENGINE_CREATED', 'ENGINE_CLOSED', 'ACTIVITY_STARTED',
  'ACTIVITY_COMPLETED', 'ACTIVITY_CANCELLED', 'ACTIVITY_SIGNALED', 'ACTIVITY_COMPENSATE', 'ACTIVITY_MESSAGE_SENT', 'ACTIVITY_MESSAGE_WAITING',
  'ACTIVITY_MESSAGE_RECEIVED', 'ACTIVITY_ERROR_RECEIVED', 'HISTORIC_ACTIVITY_INSTANCE_CREATED', 'HISTORIC_ACTIVITY_INSTANCE_ENDED', 'SEQUENCEFLOW_TAKEN',
  'UNCAUGHT_BPMN_ERROR', 'VARIABLE_CREATED', 'VARIABLE_UPDATED', 'VARIABLE_DELETED', 'TASK_CREATED', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'PROCESS_STARTED',
  'PROCESS_COMPLETED', 'PROCESS_COMPLETED_WITH_ERROR_END_EVENT', 'PROCESS_CANCELLED', 'HISTORIC_PROCESS_INSTANCE_CREATED', 'HISTORIC_PROCESS_INSTANCE_ENDED',
  'MEMBERSHIP_CREATED', 'MEMBERSHIP_DELETED', 'MEMBERSHIPS_DELETED',
];

export function eventTypesDiagnostic(value: string | undefined): Diagnostic | undefined {
  if (!value) return undefined;
  const names = value.split(',').map((n) => n.trim()).filter(Boolean);
  const unknown = names.filter((n) => !ACTIVITI_EVENT_TYPES.includes(n));
  if (unknown.length > 0) return { severity: 'error', message: `Unknown event type${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Pick them from the list below (names are case sensitive).` };
  return undefined;
}

export interface EventTypesEntryProps {
  element: { id: string };
  id: string;
  label: ComponentChildren;
  getValue(element: unknown): string | undefined;
  setValue(value: string | undefined, error?: Diagnostic | null): void;
  debounce(fn: (...args: never[]) => unknown): ((...args: never[]) => unknown) & { flush?: () => void; cancel?: () => void };
  tooltip?: ComponentChildren;
  description?: ComponentChildren;
}

/** The `events` of an event listener: a comma separated list of `ActivitiEventType` names, typed or picked from the list. */
export function EventTypesEntry(props: EventTypesEntryProps) {
  return <EventTypesBody key={props.element.id} {...props} />;
}

function EventTypesBody(props: EventTypesEntryProps) {
  const { id, element, label, getValue } = props;
  const model = getValue(element) ?? '';
  const [text, setText] = useState(model);
  const ref = useShowEntryEvent(id);
  const textRef = useRef(text);
  textRef.current = text;
  const expected = useRef(model);

  useEffect(() => {
    if (model === expected.current) return;
    expected.current = model;
    setText(model);
  }, [model]);

  // the write is made once, so it calls the props of the last render (the setValue of a list item writes the item as it is now)
  const latest = useRef(props);
  latest.current = props;

  const write = useMemo(() => {
    const run = (): void => {
      const { getValue: read, setValue: store } = latest.current;
      const next = textRef.current.trim() === '' ? undefined : textRef.current.split(',').map((n) => n.trim()).filter(Boolean).join(',');
      if ((next ?? '') === (read(element) ?? '')) return;
      const problem = eventTypesDiagnostic(next);
      expected.current = next ?? '';
      store(next, problem ?? null);
    };
    return Object.assign(props.debounce(run), { now: run });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.debounce]);

  const selected = new Set(text.split(',').map((n) => n.trim()).filter(Boolean));
  const toggle = (name: string, checked: boolean): void => {
    const next = ACTIVITI_EVENT_TYPES.filter((n) => (n === name ? checked : selected.has(n)));
    const unknown = [...selected].filter((n) => !ACTIVITI_EVENT_TYPES.includes(n));
    textRef.current = [...next, ...unknown].join(',');
    setText(textRef.current);
    write.cancel?.();
    write.now();
  };
  const diagnostic = useEntryDiagnostic(id, eventTypesDiagnostic(text));
  const inputId = `bio-properties-panel-${id}`;
  return (
    <EntryShell id={id} element={element} diagnostic={diagnostic} description={props.description} className="activiti-event-types">
      <EntryLabel id={id} label={label} tooltip={props.tooltip} element={element} htmlFor={inputId} />
      <input
        ref={ref as never}
        id={inputId}
        type="text"
        class="bio-properties-panel-input"
        spellcheck={false}
        autocomplete="off"
        placeholder="all events"
        value={text}
        onInput={(e) => {
          textRef.current = (e.target as HTMLInputElement).value;
          setText(textRef.current);
          write();
        }}
        onBlur={() => {
          write.cancel?.();
          write.now();
        }}
      />
      <details class="activiti-event-types__list">
        <summary>Choose event types{selected.size > 0 ? ` (${selected.size} selected)` : ''}</summary>
        <div class="activiti-event-types__grid">
          {ACTIVITI_EVENT_TYPES.map((name) => (
            <label key={name} class="activiti-event-types__item">
              <input type="checkbox" checked={selected.has(name)} data-event-type={name} onInput={(e) => toggle(name, (e.target as HTMLInputElement).checked)} /> {name}
            </label>
          ))}
        </div>
      </details>
    </EntryShell>
  );
}
