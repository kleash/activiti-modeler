import type { InstanceDetail } from '@activiti-modeler/runtime-client';

/** One step of a scenario file (`schemas/scenario.schema.json`): an object with exactly one key. */
export type RecordedStep = Record<string, unknown>;

export interface RecorderSnapshot {
  recording: boolean;
  /** The instance being recorded (known after the start). */
  instanceId: string | undefined;
  /** What it was started as: the process key or the message name. */
  subject: string | undefined;
  steps: number;
}

export interface RecordedStart {
  instanceId: string;
  process?: string;
  message?: string;
  businessKey?: string;
  variables?: Record<string, unknown>;
  user: string;
}

/** A scenario file as `JSON.stringify` writes it. */
export interface RecordedScenarioFile {
  name: string;
  users: Record<string, string[]>;
  scenarios: Array<Record<string, unknown>>;
}

const sameSnapshot = (a: RecorderSnapshot, b: RecorderSnapshot): boolean => a.recording === b.recording && a.instanceId === b.instanceId && a.subject === b.subject && a.steps === b.steps;

/**
 * Record a scenario from an interactive run (R7): while it records, the start of an instance and what the person does with it in the
 * instance view (claim, complete tasks with variables, messages, signals, receive tasks, timers, jobs, variable edits) are kept as the
 * steps of a scenario. When the person saves, the final state of the instance becomes the expectations (state, end events, the
 * activities entered, the variables), so the file replays the run and fails when the model later behaves differently.
 *
 * The expectations are what the engine did: they say "this is how it behaved when I recorded it", which suits a regression test of a
 * model that is being edited. They are not an oracle that the model is right, and the person is expected to read the file.
 */
export class ScenarioRecorder {
  private readonly listeners = new Set<() => void>();
  private recording = false;
  private instanceId: string | undefined;
  private subject: string | undefined;
  private start: Omit<RecordedStart, 'instanceId'> | undefined;
  private steps: RecordedStep[] = [];
  private readonly groups = new Map<string, Set<string>>();
  private snap: RecorderSnapshot = { recording: false, instanceId: undefined, subject: undefined, steps: 0 };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RecorderSnapshot => this.snap;

  private emit(): void {
    const next: RecorderSnapshot = { recording: this.recording, instanceId: this.instanceId, subject: this.subject, steps: this.steps.length };
    if (sameSnapshot(next, this.snap)) return;
    this.snap = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Starts recording: the next instance that is started becomes the scenario. */
  begin(): void {
    this.reset();
    this.recording = true;
    this.emit();
  }

  /** Drops what was recorded. */
  discard(): void {
    this.reset();
    this.emit();
  }

  private reset(): void {
    this.recording = false;
    this.instanceId = undefined;
    this.subject = undefined;
    this.start = undefined;
    this.steps = [];
    this.groups.clear();
  }

  get isWaitingForStart(): boolean {
    return this.recording && this.instanceId === undefined;
  }

  /** The start of the instance to record (only the first one after `begin`). */
  noteStart(start: RecordedStart): void {
    if (!this.isWaitingForStart) return;
    const { instanceId, ...rest } = start;
    this.instanceId = instanceId;
    this.subject = start.process ?? start.message;
    this.start = rest;
    this.emit();
  }

  /** A step on the recorded instance; ignored for any other instance and when not recording. */
  note(instanceId: string, step: RecordedStep, user?: { name: string; groups?: readonly string[] }): void {
    if (!this.recording || this.instanceId !== instanceId) return;
    this.steps.push(step);
    if (user) {
      const groups = this.groups.get(user.name) ?? new Set<string>();
      for (const g of user.groups ?? []) groups.add(g);
      this.groups.set(user.name, groups);
    }
    this.emit();
  }

  /** True when `instanceId` is the instance being recorded. */
  isRecording(instanceId: string): boolean {
    return this.recording && this.instanceId === instanceId;
  }

  /** The scenario file for the recorded run, with the expectations read from the final state of the instance. */
  build(name: string, final: InstanceDetail): RecordedScenarioFile {
    if (!this.start) throw new Error('nothing was recorded: start an instance while recording');
    const { process, message, businessKey, variables, user } = this.start;
    const users: Record<string, string[]> = {};
    const known = new Set<string>([user, ...this.groups.keys()]);
    for (const u of known) users[u] = [...(this.groups.get(u) ?? [])].sort();
    const entered: string[] = [];
    for (const a of final.path.activities) if (!entered.includes(a.activityId)) entered.push(a.activityId);
    const endEvents = [...new Set(final.path.activities.filter((a) => a.activityType === 'endEvent').map((a) => a.activityId))];
    const deadLetters = final.jobs.filter((j) => j.kind === 'DEADLETTER');
    const state = final.state === 'COMPLETED' ? 'COMPLETED' : deadLetters.length > 0 ? 'DEADLETTER' : 'ACTIVE';
    const finalVariables: Record<string, unknown> = {};
    for (const v of final.variables) if (v.value !== null && v.value !== undefined) finalVariables[v.name] = v.value;
    const expect: Record<string, unknown> = { state };
    if (endEvents.length > 0) expect['endEvents'] = endEvents;
    if (entered.length > 0) expect['path'] = { contains: entered };
    if (Object.keys(finalVariables).length > 0) expect['variables'] = finalVariables;
    if (deadLetters.length > 0) {
      expect['deadLetterJobs'] = deadLetters.filter((j) => j.activityId).map((j) => ({ activity: j.activityId, ...(j.exceptionMessage ? { exceptionMessageContains: j.exceptionMessage.slice(0, 80) } : {}) }));
    }
    return {
      name,
      users,
      scenarios: [
        {
          name,
          start: {
            ...(process ? { process } : { message }),
            ...(businessKey ? { businessKey } : {}),
            user,
            ...(variables && Object.keys(variables).length > 0 ? { variables } : {}),
          },
          steps: this.steps,
          expect,
        },
      ],
    };
  }
}

export const recorder = new ScenarioRecorder();
