/**
 * What a diagram shows of a running or finished process instance, and how that is derived from the runtime REST API's answer.
 * Pure (no DOM), so it is testable on its own and usable by any host page.
 */

/** How a flow node relates to a running or finished process instance. */
export type ActivityState = 'active' | 'completed' | 'incident';

/** CSS marker class the viewer adds to a flow node in the given state (styled by `viewer.css`; a host may restyle it). */
export function markerClass(state: ActivityState): string {
  return `activiti-${state}`;
}

/** CSS marker class of a sequence flow that was taken. */
export const FLOW_TAKEN_CLASS = 'activiti-flow-taken';

/** Activity states by BPMN element id, as shown on the diagram. */
export type ActivityStates = Readonly<Record<string, ActivityState>>;

/** Element ids in a given state, in a stable order. */
export function elementsInState(states: ActivityStates, state: ActivityState): string[] {
  return Object.keys(states)
    .filter((id) => states[id] === state)
    .sort();
}

/** What to draw on a diagram. Every member is optional; ids that are not in the diagram are ignored. */
export interface ViewerOverlays {
  /** Flow nodes with a token (the instance waits there). */
  active?: readonly string[];
  /** Flow nodes the instance has passed. */
  completed?: readonly string[];
  /** Sequence flows that were taken. */
  flows?: readonly string[];
  /** Flow nodes with a failed job or a dead-letter job. */
  incidents?: readonly string[];
  /** Number of tokens by element (default: 1 for every active element). */
  tokens?: Readonly<Record<string, number>>;
  /** Small text badge by element, for example `2 jobs` or `visited 3x`. */
  badges?: Readonly<Record<string, string>>;
}

/** What the viewer knows of the loaded diagram, for the inference below. */
export interface DiagramStructure {
  /** The id of the flow-node container (sub process, transaction, event sub process) of an element, if any. */
  parentOf(id: string): string | undefined;
  /** Is this element an event sub process? */
  isEventSubProcess(id: string): boolean;
  /** Is this element a flow node or a sequence flow of the diagram? */
  has(id: string): boolean;
}

/** The members of the runtime REST API's `InstanceDetail` the overlays need. */
export interface InstanceOverlayInput {
  state?: string;
  activeActivityIds: readonly string[];
  jobs?: ReadonlyArray<{ activityId?: string | undefined; kind: string; exceptionMessage?: string | undefined; retries?: number | undefined }>;
  path: {
    activities: ReadonlyArray<{ activityId: string; activityType: string; endTime?: string | undefined }>;
    sequenceFlows: ReadonlyArray<{ id: string }>;
    sequenceFlowsSource?: string | undefined;
  };
}

/** History types that are not elements of the diagram. */
const NOT_ELEMENTS = new Set(['processInstance']);

/**
 * The overlays of one process instance.
 *
 * - **active**: the activity ids that hold a token; a sub process around an active activity is active too.
 * - **completed**: activities with an end time, and every container that holds a visited element. Activiti records **no** historic
 *   activity instance for an event sub process, so it is inferred from what ran inside it (its start event is recorded)
 *   - `docs/engine-findings.md`, C08.1.
 * - **flows**: the sequence flows the server reports; `sequenceFlowsSource` says whether they were recorded or inferred.
 * - **incidents**: activities with a dead-letter job (or a job whose retries are used up).
 */
export function overlaysForInstance(instance: InstanceOverlayInput, structure?: DiagramStructure): ViewerOverlays {
  const active = new Set<string>(instance.activeActivityIds);
  const completed = new Set<string>();
  const listed = new Map<string, number>();
  for (const id of instance.activeActivityIds) listed.set(id, (listed.get(id) ?? 0) + 1);
  const unfinished = new Map<string, number>();
  for (const step of instance.path.activities) {
    if (NOT_ELEMENTS.has(step.activityType)) continue;
    if (step.endTime !== undefined && step.endTime !== null && step.endTime !== '') completed.add(step.activityId);
    else {
      active.add(step.activityId);
      unfinished.set(step.activityId, (unfinished.get(step.activityId) ?? 0) + 1);
    }
  }
  const tokenHolders = [...active].map((id) => [id, Math.max(listed.get(id) ?? 0, unfinished.get(id) ?? 0)] as const);
  const incidents = new Set<string>();
  for (const job of instance.jobs ?? []) {
    if (job.activityId && (job.kind === 'DEADLETTER' || (job.retries !== undefined && job.retries <= 0 && job.exceptionMessage))) incidents.add(job.activityId);
  }
  const flows = new Set(instance.path.sequenceFlows.map((f) => f.id));
  if (structure) {
    const ancestors = (id: string): string[] => {
      const out: string[] = [];
      for (let parent = structure.parentOf(id); parent !== undefined && !out.includes(parent); parent = structure.parentOf(parent)) out.push(parent);
      return out;
    };
    // a container around an active element holds a token; a container around a visited one was entered (an event sub process has no history of its own)
    for (const id of [...active]) for (const parent of ancestors(id)) active.add(parent);
    for (const id of [...completed, ...flows]) {
      if (!structure.has(id)) continue;
      for (const parent of ancestors(id)) if (!active.has(parent)) completed.add(parent);
    }
  }
  for (const id of active) completed.delete(id);
  // a token sits on the activity that waits, not on the containers around it
  const tokens: Record<string, number> = {};
  for (const [id, count] of tokenHolders) tokens[id] = Math.max(1, count);
  return { active: [...active].sort(), completed: [...completed].sort(), flows: [...flows].sort(), incidents: [...incidents].sort(), tokens };
}

/** The overlays a scenario run reports: the nodes and flows it visited. */
export function overlaysForVisits(visits: { nodes?: readonly string[] | undefined; flows?: readonly string[] | undefined } | undefined): ViewerOverlays {
  return { completed: [...(visits?.nodes ?? [])].sort(), flows: [...(visits?.flows ?? [])].sort() };
}
