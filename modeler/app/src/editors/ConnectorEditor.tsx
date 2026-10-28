import {
  bumpVersion, CONNECTOR_PARAMETER_TYPES, classifyFile, connectorKeyOf, connectorMetaOf, parseConnectorModel, readConnectorMeta, serializeConnector, validateConnector, writeConnectorMeta,
  type ConnectorAction, type ConnectorModel, type ConnectorProblem, type ProjectFileData,
} from '@activiti-modeler/activiti-project';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { EditorProps } from '../state/types';
import './connector-editor.css';

// --- the draft: what the form edits ---------------------------------------------------------------------------------------------------

interface ParamDraft {
  key: number;
  id: string;
  name: string;
  description: string;
  type: string;
  required: boolean;
  /** The runtime's display, displayName, analytics and ephemeral: kept as they are. */
  rest: Pick<ConnectorAction['inputs'][number], 'display' | 'displayName' | 'analytics' | 'ephemeral'>;
}

interface ActionDraft {
  key: number;
  id: string;
  name: string;
  description: string;
  inputs: ParamDraft[];
  outputs: ParamDraft[];
}

interface ConfigDraft {
  key: number;
  name: string;
  description: string;
  value: string;
  required: boolean;
}

interface Draft {
  id: string;
  name: string;
  description: string;
  version: string;
  actions: ActionDraft[];
  config: ConfigDraft[];
  /** Kept as they are: events and the fields the schema does not know. */
  original: ConnectorModel;
}

let nextKey = 1;

const toParams = (list: ConnectorAction['inputs']): ParamDraft[] =>
  list.map((p) => ({
    key: nextKey++, id: p.id, name: p.name, description: p.description ?? '', type: p.type, required: p.required === true,
    rest: { ...(p.display !== undefined ? { display: p.display } : {}), ...(p.displayName ? { displayName: p.displayName } : {}), ...(p.analytics !== undefined ? { analytics: p.analytics } : {}), ...(p.ephemeral !== undefined ? { ephemeral: p.ephemeral } : {}) },
  }));

function toDraft(model: ConnectorModel): Draft {
  return {
    id: model.id,
    name: model.name,
    description: model.description ?? '',
    version: model.version ?? '',
    actions: Object.values(model.actions).map((a) => ({ key: nextKey++, id: a.id, name: a.name, description: a.description ?? '', inputs: toParams(a.inputs), outputs: toParams(a.outputs) })),
    config: model.config.map((c) => ({ key: nextKey++, name: c.name, description: c.description ?? '', value: c.value ?? '', required: c.required === true })),
    original: model,
  };
}

const fromParams = (list: ParamDraft[]): ConnectorAction['inputs'] =>
  list.map((p) => ({ id: p.id || p.name, name: p.name, ...(p.description ? { description: p.description } : {}), type: p.type, ...(p.required ? { required: true } : {}), ...p.rest }));

function toModel(draft: Draft): ConnectorModel {
  const model: ConnectorModel = {
    ...draft.original,
    id: draft.id || draft.name,
    name: draft.name,
    actions: {},
    config: draft.config.map((c) => ({ name: c.name, ...(c.description ? { description: c.description } : {}), ...(c.value !== '' ? { value: c.value } : {}), ...(c.required ? { required: true } : {}) })),
  };
  delete model.description;
  delete model.version;
  delete model.legacyFields; // the file is written without them
  if (draft.description) model.description = draft.description;
  if (draft.version.trim() !== '') model.version = draft.version.trim();
  for (const a of draft.actions) {
    model.actions[a.id] = { id: a.id, name: a.name, ...(a.description ? { description: a.description } : {}), inputs: fromParams(a.inputs), outputs: fromParams(a.outputs) };
  }
  return model;
}

/** What the generated element templates depend on: the actions with their parameters. */
const shapeOf = (model: ConnectorModel): string => JSON.stringify(Object.values(model.actions).map((a) => [a.id, a.name, a.inputs.map((p) => [p.name, p.type, p.required]), a.outputs.map((p) => [p.name, p.type])]));

function problemsOf(draft: Draft, otherNames: string[]): ConnectorProblem[] {
  const problems = validateConnector(toModel(draft), otherNames);
  const seen = new Set<string>();
  for (const a of draft.actions) {
    if (a.id && seen.has(a.id)) problems.push({ severity: 'error', path: `actions.${a.id}`, message: `The action "${a.id}" is declared twice.` });
    seen.add(a.id);
  }
  return problems;
}

// --- small form parts ---------------------------------------------------------------------------------------------------------------

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="connector-field">
      <span className="connector-field__label">{label}</span>
      {children}
      {hint ? <span className="connector-field__hint">{hint}</span> : null}
    </label>
  );
}

interface ParamsProps {
  kind: 'input' | 'output';
  prefix: string;
  params: ParamDraft[];
  invalid(path: string): boolean;
  pathPrefix: string;
  change(next: ParamDraft[]): void;
}

function Params({ kind, prefix, params, invalid, pathPrefix, change }: ParamsProps) {
  const set = (index: number, patch: Partial<ParamDraft>): void => change(params.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  return (
    <div className="connector-params" data-testid={`${prefix}-${kind}s`}>
      <div className="connector-params__title">
        <strong>{kind === 'input' ? 'Inputs' : 'Outputs'}</strong>
        <button type="button" className="btn small" data-testid={`${prefix}-add-${kind}`} onClick={() => change([...params, { key: nextKey++, id: '', name: '', description: '', type: 'string', required: false, rest: {} }])}>
          Add {kind}
        </button>
      </div>
      {params.length === 0 ? <p className="connector-empty">No {kind}s.</p> : null}
      {params.map((p, index) => (
        <div className="connector-param" key={p.key} data-testid={`${prefix}-${kind}-${index}`}>
          <input
            aria-label={`${kind} name`}
            data-testid={`${prefix}-${kind}-${index}-name`}
            className={invalid(`${pathPrefix}.${kind}s[${index}].name`) ? 'invalid' : ''}
            value={p.name}
            placeholder="name"
            onChange={(e) => set(index, { name: e.target.value, ...(p.id === p.name || p.id === '' ? { id: e.target.value } : {}) })}
          />
          <select aria-label={`${kind} type`} data-testid={`${prefix}-${kind}-${index}-type`} className={invalid(`${pathPrefix}.${kind}s[${index}].type`) ? 'invalid' : ''} value={p.type} onChange={(e) => set(index, { type: e.target.value })}>
            {[...CONNECTOR_PARAMETER_TYPES, ...(CONNECTOR_PARAMETER_TYPES.includes(p.type as never) ? [] : [p.type])].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {kind === 'input' ? (
            <label className="connector-check">
              <input type="checkbox" data-testid={`${prefix}-${kind}-${index}-required`} checked={p.required} onChange={(e) => set(index, { required: e.target.checked })} /> required
            </label>
          ) : null}
          <input aria-label={`${kind} description`} data-testid={`${prefix}-${kind}-${index}-description`} value={p.description} placeholder="description" onChange={(e) => set(index, { description: e.target.value })} />
          <button type="button" className="btn small" aria-label={`Remove ${kind}`} data-testid={`${prefix}-${kind}-${index}-remove`} onClick={() => change(params.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// --- the editor ---------------------------------------------------------------------------------------------------------------------------

const WORKING_COPY_DELAY_MS = 250;

/**
 * `project.json` with this connector's entry set to `meta`; the text as it is when that changes nothing (so an untouched project.json
 * is never rewritten), undefined (and the reason in `fail`) when project.json cannot take it.
 */
function projectTextFor(current: string | undefined, key: string, meta: ReturnType<typeof connectorMetaOf>, fail: (message: string | undefined) => void): string | undefined {
  const entry = readConnectorMeta(current)[key];
  if (JSON.stringify(entry ?? null) === JSON.stringify(meta ?? null)) {
    // unchanged in the file; still make sure it parses when there is something to keep
    if (meta !== undefined && current !== undefined) {
      try {
        JSON.parse(current);
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    }
    fail(undefined);
    return current;
  }
  try {
    const next = writeConnectorMeta(current, key, meta);
    fail(undefined);
    return next;
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

const PROJECT_FILE = 'project.json';

/**
 * The connector catalog editor (feature U15): the actions of a connector with their typed inputs and outputs, the configuration, the
 * name rules and the version. The element templates the panel offers are generated from what is saved here, and an open diagram sees
 * an edit as soon as it is made (the working copy of the file is the catalog).
 *
 * `connectors/<name>.json` is read by the Activiti runtime, so it holds only the runtime's fields (ADR 0003). The version and the
 * configuration of the connector are the modeler's: they are kept in `project.json`, `connectors.<name>`, and saved together with the
 * file.
 */
export function ConnectorTabEditor({ tab, host, active }: EditorProps) {
  const ws = host.workspace;
  const stem = tab.path.slice(tab.path.lastIndexOf('/') + 1).replace(/\.json$/, '');
  const initial = useMemo(() => ws.model.read(tab.path) ?? '', [ws, tab.path]);
  const parsed = useMemo(() => parseConnectorModel(initial, stem, readConnectorMeta(ws.model.read(PROJECT_FILE))[stem]), [ws, initial, stem]);
  const [draft, setDraft] = useState<Draft | undefined>(() => (parsed ? toDraft(parsed) : undefined));
  const [version, setVersion] = useState(0);
  const pathRef = useRef(tab.path);
  pathRef.current = tab.path;
  const stemRef = useRef(stem);
  stemRef.current = stem;
  const draftRef = useRef<Draft | undefined>(draft);
  const text = useRef(initial);
  const [projectError, setProjectError] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const otherNames = (): string[] =>
    ws.model
      .paths()
      .filter((p) => classifyFile(p) === 'connector' && p !== pathRef.current)
      .flatMap((p) => {
        const other = parseConnectorModel(ws.model.read(p) ?? '', p.slice(p.lastIndexOf('/') + 1).replace(/\.json$/, ''));
        return other ? [other.name] : [];
      });
  const problems = useMemo(
    () => {
      if (!draft) return [];
      const found = problemsOf(draft, otherNames());
      if (projectError) found.push({ severity: 'error', path: 'project.json', message: `project.json is not valid JSON (${projectError}): fix it, then the version and the configuration of the connector can be kept there.` });
      return found;
    },
    [draft, version, projectError], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** project.json with the entry of this connector as the draft has it, from project.json as it is now; undefined while it cannot take it (not JSON). */
  const projectTextNow = useCallback(
    (draftNow: Draft | undefined, key: string): string | undefined =>
      draftNow ? projectTextFor(ws.model.read(PROJECT_FILE), key, connectorMetaOf(toModel(draftNow)), setProjectError) : ws.model.read(PROJECT_FILE),
    [ws],
  );

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    const path = pathRef.current;
    if (ws.model.has(path) || ws.model.isDirty(path)) await ws.edit(path, text.current);
    const project = projectTextNow(draftRef.current, stemRef.current);
    if (project !== undefined && project !== ws.model.read(PROJECT_FILE)) await ws.edit(PROJECT_FILE, project);
  }, [ws, projectTextNow]);

  useEffect(() => {
    host.setHandle({
      async serialize(target: string): Promise<ProjectFileData[]> {
        const files: ProjectFileData[] = [{ path: target, content: text.current }];
        // the version and the configuration are saved with the file, in project.json (under the name of the file saved)
        const key = connectorKeyOf(target);
        const meta = draftRef.current ? connectorMetaOf(toModel(draftRef.current)) : undefined;
        const base = ws.model.read(PROJECT_FILE);
        // Compared with project.json as it was saved, not with the working copy: the working copy already holds the entry once the
        // pause after the last edit has passed (see `flush`), and a save then would leave the version and the configuration unsaved.
        const saved = ws.model.saved(PROJECT_FILE);
        // writeConnectorMeta throws a readable error when project.json is not JSON; the tab then stays unsaved
        if (JSON.stringify(readConnectorMeta(saved)[key] ?? null) !== JSON.stringify(meta ?? null) || (meta !== undefined && saved === undefined)) files.push({ path: PROJECT_FILE, content: writeConnectorMeta(base, key, meta) });
        return files;
      },
      markSaved: () => host.setDirty(false),
    });
    host.setDirty(ws.model.isDirty(tab.path));
    const stop = ws.model.onChange(() => setVersion((v) => v + 1));
    return () => {
      stop();
      clearTimeout(timer.current);
      host.setHandle(undefined);
    };
    // the handle reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a descriptor that still carries modeler-only fields is rewritten (and its fields moved to project.json) when it is saved
  useEffect(() => {
    if (parsed?.legacyFields?.length) update((d) => d);
    // once, on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (mutate: (d: Draft) => Draft): void => {
    setDraft((current) => {
      if (!current) return current;
      const next = mutate(current);
      draftRef.current = next;
      const model = toModel(next);
      text.current = serializeConnector(model);
      const project = projectTextFor(ws.model.read(PROJECT_FILE), stemRef.current, connectorMetaOf(model), setProjectError);
      host.setDirty(text.current !== ws.model.saved(pathRef.current) || (project !== undefined && project !== ws.model.saved(PROJECT_FILE)));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), WORKING_COPY_DELAY_MS);
      return next;
    });
  };

  if (!draft) {
    return (
      <div className="connector-editor" data-testid="connector-editor">
        <div className="notice" role="alert">
          {tab.path} is not a JSON object, so the connector editor cannot show it.{' '}
          <button type="button" className="link" onClick={() => host.openWith('json')}>
            Open it as JSON
          </button>
        </div>
      </div>
    );
  }

  const invalidPaths = new Set(problems.filter((p) => p.severity === 'error').map((p) => p.path));
  const invalid = (path: string): boolean => invalidPaths.has(path);
  const model = toModel(draft);
  const baseline = parseConnectorModel(ws.model.saved(tab.path) ?? initial, stem, readConnectorMeta(ws.model.saved(PROJECT_FILE))[stem]);
  const legacyFields = parseConnectorModel(ws.model.saved(tab.path) ?? '', stem)?.legacyFields ?? [];
  const changedShape = baseline ? shapeOf(baseline) !== shapeOf(model) : false;
  const sameVersion = (baseline?.version ?? '') === draft.version.trim();
  const setAction = (key: number, patch: Partial<ActionDraft>): void => update((d) => ({ ...d, actions: d.actions.map((a) => (a.key === key ? { ...a, ...patch } : a)) }));
  const errors = problems.filter((p) => p.severity === 'error').length;

  return (
    <div className="connector-editor" data-testid="connector-editor" data-active={active}>
      <div className="connector-toolbar">
        <h2>Connector {draft.name || stem}</h2>
        <span className="connector-toolbar__status" data-testid="connector-status">
          {errors === 0 ? 'No problems' : `${errors} problem${errors === 1 ? '' : 's'}`}
        </span>
        <button type="button" className="link" data-testid="connector-open-json" onClick={() => void flush().then(() => host.openWith('json'))}>
          Edit as JSON
        </button>
      </div>

      {problems.length > 0 ? (
        <ul className="connector-problems" data-testid="connector-problems" aria-label="Problems">
          {problems.map((p, i) => (
            <li key={i} className={`connector-problem connector-problem--${p.severity}`} data-testid="connector-problem" data-path={p.path}>
              {p.message}
            </li>
          ))}
        </ul>
      ) : null}

      {legacyFields.length > 0 ? (
        <div className="connector-note" data-testid="connector-legacy-note" role="note">
          The saved file carries {legacyFields.join(', ')}, which the Activiti runtime does not read. Saving moves {legacyFields.length === 1 ? 'it' : 'them'} to project.json (connectors.{stem}).
        </div>
      ) : null}

      {changedShape && sameVersion ? (
        <div className="connector-note" data-testid="connector-version-note" role="note">
          The actions changed but the version is still {draft.version.trim() || '(none)'}. Tasks created from this connector's templates are only reported as outdated, and can only be updated, when the version changes.{' '}
          <button type="button" className="btn small" data-testid="connector-note-bump" onClick={() => update((d) => ({ ...d, version: bumpVersion(d.version) }))}>
            Bump the version
          </button>
        </div>
      ) : null}

      <section className="connector-section">
        <Field label="Name" hint="Lower case letters, digits and hyphens, at most 26 characters, no dot. A service task calls <name>.<ACTION>.">
          <input
            data-testid="connector-name"
            className={invalid('name') ? 'invalid' : ''}
            value={draft.name}
            onChange={(e) => update((d) => ({ ...d, name: e.target.value, ...(d.id === d.name ? { id: e.target.value } : {}) }))}
          />
        </Field>
        <Field label="Description">
          <input data-testid="connector-description" value={draft.description} onChange={(e) => update((d) => ({ ...d, description: e.target.value }))} />
        </Field>
        <Field label="Version" hint="The version of the element templates of this connector. Change it when the actions change: tasks made from an older version are then reported.">
          <span className="connector-version">
            <input data-testid="connector-version" className={invalid('version') ? 'invalid' : ''} value={draft.version} placeholder="1" onChange={(e) => update((d) => ({ ...d, version: e.target.value }))} />
            <button type="button" className="btn small" data-testid="connector-bump-version" onClick={() => update((d) => ({ ...d, version: bumpVersion(d.version) }))}>
              Bump
            </button>
          </span>
        </Field>
      </section>

      <section className="connector-section">
        <div className="connector-section__title">
          <h3>Actions</h3>
          <button
            type="button"
            className="btn small"
            data-testid="connector-add-action"
            onClick={() => update((d) => ({ ...d, actions: [...d.actions, { key: nextKey++, id: '', name: '', description: '', inputs: [], outputs: [] }] }))}
          >
            Add action
          </button>
        </div>
        {draft.actions.length === 0 ? <p className="connector-empty">No actions: no service task can call this connector.</p> : null}
        {draft.actions.map((a, index) => {
          const prefix = `action-${a.id || `new${index}`}`;
          const where = `actions.${a.id}`;
          return (
            <div className="connector-action" key={a.key} data-testid={prefix}>
              <div className="connector-action__head">
                <span className="connector-action__call" data-testid={`${prefix}-call`}>
                  {draft.name || '<connector>'}.{a.id || '<ACTION>'}
                </span>
                <button type="button" className="btn small danger" data-testid={`${prefix}-remove`} onClick={() => update((d) => ({ ...d, actions: d.actions.filter((x) => x.key !== a.key) }))}>
                  Remove action
                </button>
              </div>
              <div className="connector-action__fields">
                <Field label="Action id" hint="The part after the dot, e.g. SEND.">
                  <input data-testid={`${prefix}-id`} className={invalid(`${where}.id`) || invalid(where) ? 'invalid' : ''} value={a.id} onChange={(e) => setAction(a.key, { id: e.target.value })} />
                </Field>
                <Field label="Name">
                  <input data-testid={`${prefix}-name`} className={invalid(`${where}.name`) ? 'invalid' : ''} value={a.name} onChange={(e) => setAction(a.key, { name: e.target.value })} />
                </Field>
                <Field label="Description">
                  <input data-testid={`${prefix}-description`} value={a.description} onChange={(e) => setAction(a.key, { description: e.target.value })} />
                </Field>
              </div>
              <Params kind="input" prefix={prefix} params={a.inputs} invalid={invalid} pathPrefix={where} change={(next) => setAction(a.key, { inputs: next })} />
              <Params kind="output" prefix={prefix} params={a.outputs} invalid={invalid} pathPrefix={where} change={(next) => setAction(a.key, { outputs: next })} />
            </div>
          );
        })}
        {Object.keys(draft.original.events).length > 0 ? <p className="connector-empty">The file also defines {Object.keys(draft.original.events).length} event(s); they are kept as they are.</p> : null}
      </section>

      <section className="connector-section">
        <div className="connector-section__title">
          <h3>Configuration</h3>
          <button type="button" className="btn small" data-testid="connector-add-config" onClick={() => update((d) => ({ ...d, config: [...d.config, { key: nextKey++, name: '', description: '', value: '', required: false }] }))}>
            Add entry
          </button>
        </div>
        {draft.config.length === 0 ? <p className="connector-empty">No configuration entries.</p> : null}
        {draft.config.map((c, index) => (
          <div className="connector-param" key={c.key} data-testid={`connector-config-${index}`}>
            <input
              aria-label="configuration name"
              data-testid={`connector-config-${index}-name`}
              className={invalid(`config[${index}].name`) ? 'invalid' : ''}
              value={c.name}
              placeholder="name"
              onChange={(e) => update((d) => ({ ...d, config: d.config.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)) }))}
            />
            <input aria-label="configuration value" data-testid={`connector-config-${index}-value`} value={c.value} placeholder="value" onChange={(e) => update((d) => ({ ...d, config: d.config.map((x) => (x.key === c.key ? { ...x, value: e.target.value } : x)) }))} />
            <label className="connector-check">
              <input type="checkbox" checked={c.required} onChange={(e) => update((d) => ({ ...d, config: d.config.map((x) => (x.key === c.key ? { ...x, required: e.target.checked } : x)) }))} /> required
            </label>
            <input aria-label="configuration description" value={c.description} placeholder="description" onChange={(e) => update((d) => ({ ...d, config: d.config.map((x) => (x.key === c.key ? { ...x, description: e.target.value } : x)) }))} />
            <button type="button" className="btn small" aria-label="Remove entry" onClick={() => update((d) => ({ ...d, config: d.config.filter((x) => x.key !== c.key) }))}>
              ×
            </button>
          </div>
        ))}
      </section>

      <section className="connector-section" data-testid="connector-templates">
        <h3>Element templates</h3>
        {model.name && Object.keys(model.actions).length > 0 ? (
          <ul>
            {Object.values(model.actions).map((a) => (
              <li key={a.id} data-testid="connector-template">
                <code>
                  {model.name}.{a.id}
                </code>{' '}
                version {model.version ?? '1'}: {a.inputs.length} input(s), {a.outputs.length} output(s)
              </li>
            ))}
          </ul>
        ) : (
          <p className="connector-empty">A template is generated for every action. Name the connector and add an action.</p>
        )}
        <p className="connector-hint">
          Choose a template in the properties panel of a task (Template group) or in the replace menu. It sets the implementation, maps the inputs and outputs and declares the variables the action returns.
        </p>
      </section>
    </div>
  );
}
