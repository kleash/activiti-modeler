/** @jsxImportSource @bpmn-io/properties-panel/preact */
import type { ComponentChildren } from '@bpmn-io/properties-panel/preact';

export interface InfoEntryProps {
  id: string;
  /** `warning`: something that does not do what it seems to; `info`: how the engine treats the field. */
  severity?: 'info' | 'warning';
  /** The text, or a vnode. */
  text: ComponentChildren;
  /** Link to the user guide page of the group. */
  docs?: string;
}

/** A hint inside a group: engine behaviour the field depends on, with a link to the user guide. */
export function InfoEntry({ id, severity = 'info', text, docs }: InfoEntryProps) {
  return (
    <div class={`bio-properties-panel-entry activiti-hint activiti-hint--${severity}`} data-entry-id={id} role="note">
      <span class="activiti-hint__text">{text}</span>
      {docs ? (
        <>
          {' '}
          <a href={docs} target="_blank" rel="noopener noreferrer" class="activiti-hint__link">
            Learn more
          </a>
        </>
      ) : null}
    </div>
  );
}
