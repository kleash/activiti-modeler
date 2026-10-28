/** @jsxImportSource @bpmn-io/properties-panel/preact */
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';

export interface ActionButton {
  /** Suffix of the test id: `<entry id>.<button id>`. */
  id: string;
  label: string;
  title?: string;
  disabled?: boolean;
  run(): void;
}

export interface ActionEntryProps {
  id: string;
  severity?: 'info' | 'warning';
  /** The sentence above the buttons. */
  text?: ComponentChildren;
  buttons: ActionButton[];
  /** Link to the user guide page of the group (like a hint). */
  docs?: string;
}

/** A note with buttons: the template header of the panel ("Created from template X", Update, Unlink), the actions of the decision group. */
export function ActionEntry({ id, severity = 'info', text, buttons, docs }: ActionEntryProps) {
  return (
    <div class={`bio-properties-panel-entry activiti-hint activiti-action activiti-hint--${severity}`} data-entry-id={id} role="group" aria-label={typeof text === 'string' ? text : id}>
      {text ? <span class="activiti-hint__text">{text}</span> : null}
      {docs ? (
        <>
          {' '}
          <a href={docs} target="_blank" rel="noopener noreferrer" class="activiti-hint__link">
            Learn more
          </a>
        </>
      ) : null}
      <div class="activiti-action__buttons">
        {buttons.map((button) => (
          <button key={button.id} type="button" class="activiti-tool" disabled={button.disabled} title={button.title} data-testid={`${id}.${button.id}`} onClick={button.run}>
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}
