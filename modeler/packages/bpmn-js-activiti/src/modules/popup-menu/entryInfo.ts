/**
 * What the create / append menus say about each element they offer (feature U5): one sentence of Activiti behaviour, and the
 * page of the user guide that explains the element. The ids are those of the shared popup-entry catalog of bpmn-js.
 */

/** The user guide pages of the properties groups: `docs/user-guide/properties/<page>.md`. */
export const GUIDE_BASE = 'https://github.com/kleash/activiti-modeler/blob/main/docs/user-guide/properties/';

export interface EntryInfo {
  description: string;
  /** Page of the properties user guide (without `.md`), with an optional anchor. */
  page?: string;
  anchor?: string;
}

const ENTRY_INFO: Readonly<Record<string, EntryInfo>> = {
  // tasks
  task: { description: 'A task without behaviour: the engine passes through it. A placeholder to refine later.' },
  'user-task': { description: 'A task a person completes. Assign it to a user or offer it to candidate users and groups.', page: 'user-assignment' },
  'service-task': { description: 'Runs a Java class, an expression, a delegate bean or a connector action.', page: 'implementation' },
  'decision-task': { description: 'Evaluates a DMN decision of the project through the DMN connector and maps its outputs.', page: 'decision' },
  'send-task': { description: 'Sends a mail (activiti:type mail) with the fields you set.', page: 'mail-shell-fields' },
  'receive-task': { description: 'Waits until the application triggers it. The process stays here until then.' },
  'manual-task': { description: 'Work done outside the engine: the engine passes through it.' },
  'script-task': { description: 'Runs a script in JUEL or a JSR-223 language such as JavaScript and stores the result.', page: 'script' },
  // sub processes
  'call-activity': { description: 'Starts another process by its key and waits for it. Variables go in and out through the mapping.', page: 'called-element' },
  transaction: { description: 'A sub process whose completed work can be compensated, or cancelled together with a cancel end event.' },
  'event-subprocess': { description: 'A sub process that starts when its event happens while the surrounding scope is active.' },
  'collapsed-subprocess': { description: 'Groups steps into a scope. Collapsed: the steps are drawn in a separate view.' },
  'expanded-subprocess': { description: 'Groups steps into a scope. Expanded: the steps are drawn inside it.' },
  // gateways
  'exclusive-gateway': { description: 'Takes exactly one outgoing flow: the first whose condition is true, otherwise the default flow.', page: 'condition' },
  'parallel-gateway': { description: 'Splits into all outgoing flows and waits for every incoming flow before it continues.' },
  'inclusive-gateway': { description: 'Takes every outgoing flow whose condition is true and waits for the flows that are still active.', page: 'condition' },
  'event-based-gateway': { description: 'Waits for the first of the catch events that follow it, then continues there.' },
  // data and participants
  'data-store-reference': { description: 'A reference to a data store. Documentation only: the engine does not read it.' },
  'data-object-reference': { description: 'A data object is a process variable with a type and a default value.', page: 'data-object' },
  'expanded-pool': { description: 'A participant with its own process. Several pools make a collaboration.' },
  'collapsed-pool': { description: 'A participant drawn as a black box: another party you exchange messages with.' },
  // events: start
  'none-start-event': { description: 'Starts a process instance by an API call or from a form.', page: 'start-initiator-form' },
  'message-start': { description: 'Starts an instance when its message arrives.', page: 'event-definitions', anchor: 'message' },
  'timer-start': { description: 'Starts an instance at a date, after a duration or on a cycle.', page: 'timer' },
  'signal-start': { description: 'Starts an instance when its signal is thrown.', page: 'event-definitions', anchor: 'signal' },
  'error-start': { description: 'Starts an event sub process when a matching error is thrown in its scope.', page: 'event-definitions', anchor: 'error' },
  'non-interrupting-message-start': { description: 'Starts an event sub process on a message and lets the surrounding scope continue.', page: 'event-definitions', anchor: 'message' },
  'non-interrupting-timer-start': { description: 'Starts an event sub process on a timer and lets the surrounding scope continue.', page: 'timer' },
  'non-interrupting-signal-start': { description: 'Starts an event sub process on a signal and lets the surrounding scope continue.', page: 'event-definitions', anchor: 'signal' },
  // events: intermediate
  'none-intermediate-throwing': { description: 'A point in the flow; the engine passes through it. Execution listeners can hook in here.' },
  'message-intermediate-catch': { description: 'Waits for its message.', page: 'event-definitions', anchor: 'message' },
  'message-intermediate-throw': { description: 'Sends a message through a throw delegate (needs a custom ThrowMessageDelegate).', page: 'event-definitions', anchor: 'message' },
  'timer-intermediate-catch': { description: 'Waits until a date or for a duration.', page: 'timer' },
  'link-intermediate-catch': { description: 'The target of a link throw event with the same name.', page: 'event-definitions', anchor: 'link' },
  'link-intermediate-throw': { description: 'Continues at the link catch event with the same name, like a goto within one level.', page: 'event-definitions', anchor: 'link' },
  'compensation-intermediate-throw': { description: 'Starts the compensation handlers of completed activities.', page: 'event-definitions', anchor: 'compensation' },
  'signal-intermediate-catch': { description: 'Waits for its signal.', page: 'event-definitions', anchor: 'signal' },
  'signal-intermediate-throw': { description: 'Throws its signal to the waiting catch events. Delivery in a job needs the async executor.', page: 'event-definitions', anchor: 'signal' },
  // events: boundary
  'message-boundary': { description: 'Interrupts the activity it is attached to when its message arrives.', page: 'event-definitions', anchor: 'message' },
  'timer-boundary': { description: 'Interrupts the activity it is attached to when the timer fires.', page: 'timer' },
  'error-boundary': { description: 'Catches an error thrown inside the activity (by error code) and continues on its own flow.', page: 'event-definitions', anchor: 'error' },
  'cancel-boundary': { description: 'On a transaction: catches the cancel of the transaction.' },
  'signal-boundary': { description: 'Interrupts the activity it is attached to when its signal is thrown.', page: 'event-definitions', anchor: 'signal' },
  'compensation-boundary': { description: 'Marks the compensation handler of the activity it is attached to.', page: 'event-definitions', anchor: 'compensation' },
  'non-interrupting-message-boundary': { description: 'Starts its flow when the message arrives and leaves the activity running.', page: 'event-definitions', anchor: 'message' },
  'non-interrupting-timer-boundary': { description: 'Starts its flow when the timer fires (repeatedly for a cycle) and leaves the activity running.', page: 'timer' },
  'non-interrupting-signal-boundary': { description: 'Starts its flow when its signal is thrown and leaves the activity running.', page: 'event-definitions', anchor: 'signal' },
  // events: end
  'none-end-event': { description: 'Ends the flow. The instance ends when no flow is left.' },
  'message-end': { description: 'Ends the flow and sends a message through a throw delegate.', page: 'event-definitions', anchor: 'message' },
  'error-end': { description: 'Ends the flow by throwing an error that error boundary and error start events catch.', page: 'event-definitions', anchor: 'error' },
  'cancel-end': { description: 'Inside a transaction: cancels the transaction.' },
  'terminate-end': { description: 'Ends the whole process instance, or the surrounding scope.', page: 'event-definitions', anchor: 'terminate' },
};

/** Description and documentation link of a popup entry of the catalog, if the modeler has one for it. */
export function entryInfo(catalogId: string): (EntryInfo & { documentationRef?: string }) | undefined {
  const info = ENTRY_INFO[catalogId];
  if (!info) return undefined;
  return { ...info, ...(info.page ? { documentationRef: `${GUIDE_BASE}${info.page}.md${info.anchor ? `#${info.anchor}` : ''}` } : {}) };
}

export const ENTRY_INFO_IDS: readonly string[] = Object.keys(ENTRY_INFO);
