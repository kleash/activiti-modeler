import { useEffect, useState } from 'react';

import { t, type MessageKey } from '../i18n';
import { STEP_TYPES } from './scenarioSchema';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- field editors ----------------------------------------------------------------------------------------------------------------

type FieldKind = 'text' | 'csv' | 'json' | 'number' | 'bool';

interface FieldSpec {
  /** Key in the object; `path.contains` addresses a nested key. */
  key: string;
  /** The catalog key of the label. */
  label: MessageKey;
  kind: FieldKind;
  /** A datalist of the form (`activities`, `processes`) or a fixed list. */
  suggest?: 'activities' | 'processes' | 'users';
  placeholder?: string;
  options?: string[];
}

export interface FormSuggestions {
  activities: string[];
  processes: string[];
  users: string[];
}

function getAt(object: Json, key: string): unknown {
  let node: unknown = object;
  for (const part of key.split('.')) node = isObject(node) ? node[part] : undefined;
  return node;
}

/** A copy of `object` with the (possibly nested) key set; `undefined` removes the key (and empties a nested object that becomes empty). */
function setAt(object: Json, key: string, value: unknown): Json {
  const [head, ...rest] = key.split('.');
  const next: Json = { ...object };
  if (rest.length === 0) {
    if (value === undefined) delete next[head!];
    else next[head!] = value;
    return next;
  }
  const child = setAt(isObject(next[head!]) ? (next[head!] as Json) : {}, rest.join('.'), value);
  if (Object.keys(child).length === 0) delete next[head!];
  else next[head!] = child;
  return next;
}

function CsvInput({ value, onChange, label, list, testId }: { value: string[] | undefined; onChange(value: string[] | undefined): void; label: string; list?: string; testId?: string }) {
  const [text, setText] = useState((value ?? []).join(', '));
  useEffect(() => {
    const parsed = text.split(',').map((s) => s.trim()).filter(Boolean);
    if (JSON.stringify(parsed) !== JSON.stringify(value ?? [])) setText((value ?? []).join(', '));
    // resync only when the value changed from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      value={text}
      list={list}
      aria-label={label}
      spellCheck={false}
      data-testid={testId}
      placeholder="a, b, c"
      onChange={(e) => {
        setText(e.target.value);
        const parsed = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        onChange(parsed.length > 0 ? parsed : undefined);
      }}
    />
  );
}

function JsonInput({ value, onChange, label, testId }: { value: unknown; onChange(value: unknown): void; label: string; testId?: string }) {
  const shown = value === undefined ? '' : JSON.stringify(value);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    let current: unknown;
    try {
      current = text.trim() === '' ? undefined : JSON.parse(text);
    } catch {
      current = Symbol('invalid');
    }
    if (JSON.stringify(current) !== JSON.stringify(value)) {
      setText(shown);
      setError(undefined);
    }
    // resync only when the value changed from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <span className="json-input">
      <input
        value={text}
        aria-label={label}
        aria-invalid={!!error}
        spellCheck={false}
        data-testid={testId}
        placeholder='{"name": "value"}'
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setError(undefined);
            onChange(undefined);
            return;
          }
          try {
            onChange(JSON.parse(e.target.value));
            setError(undefined);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />
      {error && <span className="field-error small">{error}</span>}
    </span>
  );
}

function Field({ spec, object, onChange, suggestions, idPrefix }: { spec: FieldSpec; object: Json; onChange(next: Json): void; suggestions: FormSuggestions; idPrefix: string }) {
  const value = getAt(object, spec.key);
  const label = t(spec.label);
  const set = (v: unknown): void => onChange(setAt(object, spec.key, v));
  const listId = spec.suggest ? `${idPrefix}-${spec.suggest}` : undefined;
  const testId = `${idPrefix}-${spec.key}`;
  let input: React.ReactNode;
  switch (spec.kind) {
    case 'text':
      input = spec.options ? (
        <select value={typeof value === 'string' ? value : ''} aria-label={label} data-testid={testId} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)}>
          <option value="">{t('run.form.none')}</option>
          {spec.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input value={typeof value === 'string' ? value : ''} list={listId} aria-label={label} spellCheck={false} data-testid={testId} placeholder={spec.placeholder} onChange={(e) => set(e.target.value === '' ? undefined : e.target.value)} />
      );
      break;
    case 'number':
      input = <input type="number" value={typeof value === 'number' ? value : ''} aria-label={label} data-testid={testId} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))} />;
      break;
    case 'bool':
      input = <input type="checkbox" checked={value === true} aria-label={label} data-testid={testId} onChange={(e) => set(e.target.checked ? true : undefined)} />;
      break;
    case 'csv':
      input = <CsvInput value={Array.isArray(value) ? (value as string[]) : undefined} label={label} list={listId} testId={testId} onChange={set} />;
      break;
    case 'json':
      input = <JsonInput value={value} label={label} testId={testId} onChange={set} />;
      break;
  }
  void suggestions;
  return (
    <label className="form-field">
      <span>{label}</span>
      {input}
    </label>
  );
}

// ---- step and expect definitions ----------------------------------------------------------------------------------------------------

const activity = (label: MessageKey = 'run.form.activity'): FieldSpec => ({ key: 'activity', label, kind: 'text', suggest: 'activities' });

/** The common steps, with a field per member. A step type that is not here is edited as JSON. */
const STEP_FIELDS: Record<string, FieldSpec[]> = {
  completeTask: [activity('run.form.userTask'), { key: 'user', label: 'run.form.user', kind: 'text', suggest: 'users' }, { key: 'variables', label: 'run.form.variables', kind: 'json' }],
  claim: [activity('run.form.userTask'), { key: 'user', label: 'run.form.user', kind: 'text', suggest: 'users' }],
  release: [activity('run.form.userTask'), { key: 'user', label: 'run.form.user', kind: 'text', suggest: 'users' }],
  assign: [activity('run.form.userTask'), { key: 'assignee', label: 'run.form.assignTo', kind: 'text', suggest: 'users' }, { key: 'user', label: 'run.form.currentAssignee', kind: 'text', suggest: 'users' }],
  message: [{ key: 'name', label: 'run.form.messageName', kind: 'text' }, { key: 'correlationKey', label: 'run.form.correlationKey', kind: 'text' }, { key: 'variables', label: 'run.form.variables', kind: 'json' }],
  signal: [{ key: 'name', label: 'run.form.signalName', kind: 'text' }, { key: 'variables', label: 'run.form.variables', kind: 'json' }],
  triggerReceiveTask: [activity('run.form.receiveTask'), { key: 'variables', label: 'run.form.variables', kind: 'json' }],
  fireTimer: [activity('run.form.timerEvent'), { key: 'all', label: 'run.form.allTimers', kind: 'bool' }],
  executeJobs: [{ key: 'maxRounds', label: 'run.form.maxRounds', kind: 'number' }, { key: 'timeoutMs', label: 'run.form.timeout', kind: 'number' }],
  failJobUntilDeadLetter: [activity(), { key: 'maxAttempts', label: 'run.form.maxAttempts', kind: 'number' }],
  expectTimer: [activity('run.form.timerEvent'), { key: 'count', label: 'run.form.count', kind: 'number' }, { key: 'dueDate', label: 'run.form.dueDate', kind: 'text' }],
  expectTask: [
    activity('run.form.userTask'),
    { key: 'name', label: 'run.form.name', kind: 'text' },
    { key: 'assignee', label: 'run.form.assignee', kind: 'text', suggest: 'users' },
    { key: 'candidateGroups', label: 'run.form.candidateGroups', kind: 'csv' },
    { key: 'candidateUsers', label: 'run.form.candidateUsers', kind: 'csv' },
    { key: 'count', label: 'run.form.count', kind: 'number' },
  ],
};

const EXPECT_FIELDS: FieldSpec[] = [
  { key: 'state', label: 'run.form.state', kind: 'text', options: ['COMPLETED', 'ACTIVE', 'DEADLETTER'] },
  { key: 'endEvents', label: 'run.form.endEvents', kind: 'csv', suggest: 'activities' },
  { key: 'path.contains', label: 'run.form.pathContains', kind: 'csv', suggest: 'activities' },
  { key: 'path.notContains', label: 'run.form.pathNotContains', kind: 'csv', suggest: 'activities' },
  { key: 'path.sequenceFlows', label: 'run.form.sequenceFlows', kind: 'csv' },
  { key: 'variables', label: 'run.form.variables', kind: 'json' },
  { key: 'absentVariables', label: 'run.form.absentVariables', kind: 'csv' },
  { key: 'deadLetterJobs', label: 'run.form.deadLetterJobs', kind: 'json' },
];

/** The body of a step that was just added: valid where the schema allows an empty one, else to be filled in. */
function defaultStepBody(type: string): unknown {
  if (type === 'advanceClock') return 'PT1H';
  if (type === 'expectActive') return [];
  return {};
}

function describeStep(type: string, body: unknown): string {
  if (!isObject(body)) return typeof body === 'string' ? `${type} ${body}` : type;
  const target = body['activity'] ?? body['name'] ?? '';
  return `${type}${target ? ` ${String(target)}` : ''}`;
}

function StepEditor({ step, index, count, onChange, onRemove, onMove, suggestions, idPrefix }: { step: Json; index: number; count: number; onChange(step: Json): void; onRemove(): void; onMove(delta: number): void; suggestions: FormSuggestions; idPrefix: string }) {
  const type = Object.keys(step)[0] ?? '';
  const body = step[type];
  const fields = STEP_FIELDS[type];
  const prefix = `${idPrefix}-step${index}`;
  return (
    <li className="form-step" data-testid={`${prefix}`} data-step-type={type}>
      <div className="form-step-head">
        <select
          value={type}
          aria-label={t('run.form.stepType', { number: index + 1 })}
          data-testid={`${prefix}-type`}
          onChange={(e) => {
            const next = e.target.value;
            onChange({ [next]: defaultStepBody(next) });
          }}
        >
          {STEP_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="muted small">{describeStep(type, body)}</span>
        <span className="spacer" />
        <button type="button" className="btn small" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t('run.form.stepUp', { number: index + 1 })}>{t('run.form.up')}</button>
        <button type="button" className="btn small" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={t('run.form.stepDown', { number: index + 1 })}>{t('run.form.down')}</button>
        <button type="button" className="btn small" onClick={onRemove} aria-label={t('run.form.stepRemove', { number: index + 1 })} data-testid={`${prefix}-remove`}>x</button>
      </div>
      <div className="form-fields">
        {fields && isObject(body) ? (
          fields.map((spec) => <Field key={spec.key} spec={spec} object={body} idPrefix={prefix} suggestions={suggestions} onChange={(next) => onChange({ [type]: next })} />)
        ) : type === 'advanceClock' ? (
          <label className="form-field"><span>{t('run.form.duration')}</span><input value={typeof body === 'string' ? body : ''} placeholder="PT25H" aria-label={t('run.form.duration')} data-testid={`${prefix}-duration`} onChange={(e) => onChange({ advanceClock: e.target.value })} /></label>
        ) : type === 'expectActive' && Array.isArray(body) ? (
          <label className="form-field"><span>{t('run.form.activeActivities')}</span><CsvInput value={body as string[]} label={t('run.form.activeActivities')} list={`${idPrefix}-activities`} testId={`${prefix}-active`} onChange={(v) => onChange({ expectActive: v ?? [] })} /></label>
        ) : (
          <label className="form-field wide"><span>{type}</span><JsonInput value={body} label={type} testId={`${prefix}-json`} onChange={(v) => onChange({ [type]: v ?? {} })} /></label>
        )}
      </div>
    </li>
  );
}

function ScenarioEditor({ scenario, index, onChange, onRemove, onMove, count, suggestions }: { scenario: Json; index: number; count: number; onChange(next: Json): void; onRemove(): void; onMove(delta: number): void; suggestions: FormSuggestions }) {
  const prefix = `scenario${index}`;
  const start = isObject(scenario['start']) ? (scenario['start'] as Json) : {};
  const steps = Array.isArray(scenario['steps']) ? (scenario['steps'] as Json[]) : [];
  const expect = isObject(scenario['expect']) ? (scenario['expect'] as Json) : {};
  const trigger = (['process', 'message', 'signal', 'timer'] as const).find((k) => typeof start[k] === 'string') ?? 'process';
  const setStart = (next: Json): void => onChange(setAt(scenario, 'start', next));
  const setSteps = (next: Json[]): void => onChange(next.length > 0 ? { ...scenario, steps: next } : setAt(scenario, 'steps', undefined));
  const [open, setOpen] = useState(true);

  return (
    <article className="form-scenario" data-testid={prefix}>
      <header className="form-scenario-head">
        <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'v' : '>'}</button>
        <input value={typeof scenario['name'] === 'string' ? scenario['name'] : ''} aria-label={t('run.form.scenarioName', { number: index + 1 })} className="name" data-testid={`${prefix}-name`} onChange={(e) => onChange({ ...scenario, name: e.target.value })} spellCheck={false} />
        <span className="spacer" />
        <button type="button" className="btn small" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t('run.form.scenarioUp', { number: index + 1 })}>{t('run.form.up')}</button>
        <button type="button" className="btn small" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={t('run.form.scenarioDown', { number: index + 1 })}>{t('run.form.down')}</button>
        <button type="button" className="btn small" onClick={onRemove} aria-label={t('run.form.scenarioRemove', { number: index + 1 })} data-testid={`${prefix}-remove`}>x</button>
      </header>
      {open && (
        <>
          <h4>{t('run.form.start')}</h4>
          <div className="form-fields">
            <label className="form-field">
              <span>{t('run.form.startsBy')}</span>
              <select
                value={trigger}
                aria-label={t('run.form.trigger')}
                data-testid={`${prefix}-trigger`}
                onChange={(e) => {
                  const next = e.target.value as typeof trigger;
                  const { process: p, message: m, signal: s, timer: t, ...rest } = start as { process?: string; message?: string; signal?: string; timer?: string };
                  setStart({ [next]: p ?? m ?? s ?? t ?? '', ...rest });
                }}
              >
                <option value="process">{t('run.form.byProcess')}</option>
                <option value="message">{t('run.form.byMessage')}</option>
                <option value="signal">{t('run.form.bySignal')}</option>
                <option value="timer">{t('run.form.byTimer')}</option>
              </select>
            </label>
            <Field spec={{ key: trigger, label: trigger === 'process' ? 'run.form.processKey' : 'run.form.name', kind: 'text', ...(trigger === 'process' ? { suggest: 'processes' as const } : {}) }} object={start} onChange={setStart} idPrefix={`${prefix}-start`} suggestions={suggestions} />
            {trigger === 'timer' && <Field spec={{ key: 'process', label: 'run.form.processKey', kind: 'text', suggest: 'processes' }} object={start} onChange={setStart} idPrefix={`${prefix}-start`} suggestions={suggestions} />}
            <Field spec={{ key: 'businessKey', label: 'run.form.businessKey', kind: 'text' }} object={start} onChange={setStart} idPrefix={`${prefix}-start`} suggestions={suggestions} />
            <Field spec={{ key: 'user', label: 'run.form.user', kind: 'text', suggest: 'users' }} object={start} onChange={setStart} idPrefix={`${prefix}-start`} suggestions={suggestions} />
            <Field spec={{ key: 'variables', label: 'run.form.variables', kind: 'json' }} object={start} onChange={setStart} idPrefix={`${prefix}-start`} suggestions={suggestions} />
          </div>
          <h4>{t('run.form.steps')}</h4>
          <ol className="form-steps">
            {steps.map((step, i) => (
              <StepEditor
                key={i}
                step={isObject(step) ? step : {}}
                index={i}
                count={steps.length}
                suggestions={suggestions}
                idPrefix={prefix}
                onChange={(next) => setSteps(steps.map((s, j) => (j === i ? next : s)))}
                onRemove={() => setSteps(steps.filter((_, j) => j !== i))}
                onMove={(delta) => {
                  const copy = [...steps];
                  const [moved] = copy.splice(i, 1);
                  copy.splice(i + delta, 0, moved!);
                  setSteps(copy);
                }}
              />
            ))}
          </ol>
          <div className="form-add">
            <select aria-label={t('run.form.addStepLabel')} value="" data-testid={`${prefix}-add-step`} onChange={(e) => e.target.value && setSteps([...steps, { [e.target.value]: defaultStepBody(e.target.value) }])}>
              <option value="">{t('run.form.addStep')}</option>
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <h4>{t('run.form.expect')}</h4>
          <div className="form-fields">
            {EXPECT_FIELDS.map((spec) => (
              <Field key={spec.key} spec={spec} object={expect} idPrefix={`${prefix}-expect`} suggestions={suggestions} onChange={(next) => onChange(Object.keys(next).length > 0 ? { ...scenario, expect: next } : setAt(scenario, 'expect', undefined))} />
            ))}
          </div>
        </>
      )}
    </article>
  );
}

/**
 * The structured editor of a scenario file (R6): the file's name, clock and users, and per scenario its start, its steps (a field per member
 * for the common ones, JSON for the rest) and its final expectations. Every edit gives the complete new document; the JSON next to it is
 * the same document.
 */
export function ScenarioForm({ value, onChange, suggestions }: { value: Json; onChange(next: Json): void; suggestions: FormSuggestions }) {
  const scenarios = Array.isArray(value['scenarios']) ? (value['scenarios'] as Json[]) : [];
  const users = isObject(value['users']) ? (value['users'] as Record<string, string[]>) : {};
  const setScenarios = (next: Json[]): void => onChange({ ...value, scenarios: next });
  return (
    <div className="scenario-form" data-testid="scenario-form">
      <datalist id="scenario-activities">{suggestions.activities.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="scenario-processes">{suggestions.processes.map((a) => <option key={a} value={a} />)}</datalist>
      <datalist id="scenario-users">{[...new Set([...suggestions.users, ...Object.keys(users)])].map((a) => <option key={a} value={a} />)}</datalist>
      <div className="form-fields file">
        <Field spec={{ key: 'name', label: 'run.form.fileName', kind: 'text' }} object={value} onChange={onChange} idPrefix="file" suggestions={suggestions} />
        <Field spec={{ key: 'clock', label: 'run.form.clock', kind: 'text', placeholder: '2030-01-01T09:00:00Z' }} object={value} onChange={onChange} idPrefix="file" suggestions={suggestions} />
        <label className="form-field wide">
          <span>{t('run.form.users')}</span>
          <JsonInput value={value['users']} label={t('run.form.usersLabel')} testId="file-users" onChange={(v) => onChange(setAt(value, 'users', v))} />
        </label>
        <Field spec={{ key: 'description', label: 'run.form.description', kind: 'text' }} object={value} onChange={onChange} idPrefix="file" suggestions={suggestions} />
      </div>
      {scenarios.map((scenario, i) => (
        <ScenarioEditor
          key={i}
          scenario={isObject(scenario) ? scenario : {}}
          index={i}
          count={scenarios.length}
          suggestions={suggestions}
          onChange={(next) => setScenarios(scenarios.map((s, j) => (j === i ? next : s)))}
          onRemove={() => setScenarios(scenarios.filter((_, j) => j !== i))}
          onMove={(delta) => {
            const copy = [...scenarios];
            const [moved] = copy.splice(i, 1);
            copy.splice(i + delta, 0, moved!);
            setScenarios(copy);
          }}
        />
      ))}
      <button type="button" className="btn small" data-testid="add-scenario" onClick={() => setScenarios([...scenarios, { name: t('run.form.newScenario', { number: scenarios.length + 1 }), start: { process: suggestions.processes[0] ?? '' }, steps: [], expect: { state: 'COMPLETED' } }])}>
        {t('run.form.addScenario')}
      </button>
    </div>
  );
}

export { setAt, getAt };
