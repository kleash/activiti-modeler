/** @jsxImportSource @bpmn-io/properties-panel/preact */
import { useShowEntryEvent } from '@bpmn-io/properties-panel';
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';

import { EntryLabel, EntryShell, useEntryDiagnostic } from './shared';

export interface CheckEntryProps {
  element: { id: string };
  id: string;
  label: ComponentChildren;
  getValue(element: unknown): boolean;
  setValue(checked: boolean): void;
  tooltip?: ComponentChildren;
  description?: ComponentChildren;
  disabled?: boolean;
  onFocus?(event: FocusEvent): void;
  onBlur?(event: FocusEvent): void;
}

/**
 * A checkbox entry. It replaces the library's `CheckboxEntry`, which keeps the state of the box in a hook of its own and sets it, after
 * a click, to the `value` attribute of the input (the string "on") instead of `checked`: a box that was just cleared is drawn as set
 * again until the next render brings the value of the model, and a click that a person (or a test) checks right after it finds the box
 * unchanged. Here the box shows the value of the model, and after a click it shows what the model holds now, at once.
 */
export function CheckEntry({ element, id, label, getValue, setValue, tooltip, description, disabled, onFocus, onBlur }: CheckEntryProps) {
  const ref = useShowEntryEvent(id);
  const checked = getValue(element) === true;
  const diagnostic = useEntryDiagnostic(id, null);
  return (
    <EntryShell id={id} element={element} diagnostic={diagnostic} description={description} className="bio-properties-panel-checkbox-entry">
      <div class="bio-properties-panel-checkbox">
        <input
          ref={ref as never}
          id={`bio-properties-panel-${id}`}
          name={id}
          type="checkbox"
          class="bio-properties-panel-input"
          checked={checked}
          disabled={disabled}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => {
            const box = event.currentTarget;
            setValue(box.checked);
            // a write the model refused leaves the value as it was
            const now = getValue(element) === true;
            if (box.checked !== now) box.checked = now;
          }}
        />
        <EntryLabel id={id} label={label} tooltip={tooltip} element={element} />
      </div>
    </EntryShell>
  );
}
