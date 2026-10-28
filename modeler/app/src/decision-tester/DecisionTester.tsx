import { describeDmn, type DecisionDescription } from '@activiti-modeler/activiti-project';
import { RuntimeApiError, RuntimeNetworkError, type DecisionOutcome } from '@activiti-modeler/runtime-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { connection } from '../run/connection';
import { useConnection } from '../run/hooks';
import { runService } from '../run/runService';
import { inputsKey, literalText, loadInputs, parseInput, saveInputs, type RememberedInputs } from './inputs';

import './decision-tester.css';

export interface TesterOutcome {
  decisionId: string;
  outcome: DecisionOutcome;
}

interface Props {
  /** Project name and path of the DMN file: the inputs are remembered per file (feature U33). */
  project: string;
  path: string;
  /** The text of the DMN as it is now (normalized, as it would be saved). */
  getModel(): Promise<string>;
  /** The decision the open view belongs to, preselected when the user has not tested another before. */
  preferredDecision?: string | undefined;
  /** Reports the evaluation (or `undefined` when the result goes stale) so that the editor can mark the matched rules. */
  onOutcome(outcome: TesterOutcome | undefined): void;
  close(): void;
}

/** The part of the shared connection (`run/connection.ts`) a failure message names. */
export interface ConnectionInfo {
  baseUrl: string;
  username: string;
}

/** Why a request failed, in words that say what to do. */
export function describeFailure(error: unknown, connection: ConnectionInfo): string {
  const origin = connection.baseUrl.trim() || (typeof window === 'undefined' ? 'this origin' : window.location.origin);
  if (error instanceof RuntimeNetworkError) {
    return `No modeler server answered at ${origin}. Start it (java -jar activiti-modeler-server.jar) or change the address in Run > Connect to server.`;
  }
  if (error instanceof RuntimeApiError) {
    if (error.status === 401) return `The server at ${origin} did not accept the user "${connection.username}". Check the user name and password in Run > Connect to server.`;
    if (error.status === 403) return `The user "${connection.username}" may not use the dev endpoints (HTTP 403): they need the admin role. Use a user with ROLE_ACTIVITI_ADMIN, such as "modeler".`;
    if (error.status === 404 && !error.problem) {
      return `No modeler server answers at ${origin}: ${error.method} ${new URL(error.url, origin).pathname} was not found. Start the modeler server (java -jar activiti-modeler-server.jar) or change the address in Run > Connect to server.`;
    }
    return error.detail || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

const columnsOf = (rows: Array<Record<string, unknown>>): string[] => [...new Set(rows.flatMap((r) => Object.keys(r)))];
const show = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * The decision tester (features DM10, U33): evaluates a decision of the open DMN file through the modeler server
 * (`POST /api/dev/decisions/evaluate`) with typed inputs, shows the result rows, the matched rules and the decisions on the way, and
 * reports the matched rule ids to the editor, which marks them in the decision table.
 */
export function DecisionTester({ project, path, getModel, preferredDecision, onOutcome, close }: Props) {
  const key = inputsKey(project, path);
  const [model, setModel] = useState<{ decisions: DecisionDescription[]; error?: string }>({ decisions: [] });
  const remembered = useRef<RememberedInputs>(loadInputs(key));
  const [decisionId, setDecisionId] = useState<string>(remembered.current.decision ?? preferredDecision ?? '');
  const [values, setValues] = useState<Record<string, string>>({});
  const conn = useConnection();
  const info: ConnectionInfo = { baseUrl: conn.settings.baseUrl, username: conn.settings.username };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<TesterOutcome | undefined>();
  const [source, setSource] = useState<'file' | 'deployment'>('file');
  const [deployments, setDeployments] = useState<Array<{ id: string; name?: string }>>([]);
  const [deploymentId, setDeploymentId] = useState('');
  const [reference, setReference] = useState('');

  const refresh = useCallback(async () => {
    const description = describeDmn(await getModel());
    setModel(description.error ? { decisions: [], error: description.error } : { decisions: description.decisions });
    return description;
  }, [getModel]);

  useEffect(() => {
    void refresh().then((description) => {
      if (description.decisions.length === 0) return;
      setDecisionId((current) => {
        if (description.decisions.some((d) => d.id === current)) return current;
        if (preferredDecision && description.decisions.some((d) => d.id === preferredDecision)) return preferredDecision;
        return (description.decisions.find((d) => d.sink) ?? description.decisions[0]!).id;
      });
    });
  }, [refresh, preferredDecision]);

  const decision = model.decisions.find((d) => d.id === decisionId);

  // the inputs typed before for this decision of this file
  useEffect(() => {
    setValues(remembered.current.inputs[decisionId] ?? {});
    setResult(undefined);
    onOutcome(undefined);
    // the callback of the editor only reports; the decision decides what is shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionId]);

  const remember = (nextDecision: string, nextValues: Record<string, string>): void => {
    remembered.current = { decision: nextDecision, inputs: { ...remembered.current.inputs, [nextDecision]: nextValues } };
    saveInputs(key, remembered.current);
  };

  const update = (name: string, text: string): void => {
    const next = { ...values, [name]: text };
    setValues(next);
    remember(decisionId, next);
    if (result) {
      // the matched rules belong to the inputs that were evaluated
      setResult(undefined);
      onOutcome(undefined);
    }
  };

  const evaluate = async (): Promise<void> => {
    setError(undefined);
    const inputs: Record<string, unknown> = {};
    if (source === 'file' && decision) {
      for (const input of decision.inputs) {
        const parsed = parseInput(input.type, values[input.name] ?? '');
        if ('error' in parsed) {
          setError(`${input.name}: ${parsed.error}`);
          return;
        }
        if (!parsed.omit) inputs[input.name] = parsed.value;
      }
    } else if (source === 'deployment') {
      for (const [name, text] of Object.entries(values)) {
        const parsed = parseInput('Any', text);
        if ('value' in parsed) inputs[name] = parsed.value;
      }
    }
    if (conn.status !== 'connected') {
      setError('Not connected to a modeler server. Connect first (Run > Connect to server), then evaluate again.');
      runService.openConnectionDialog();
      return;
    }
    setBusy(true);
    try {
      const client = connection.require();
      let outcome: DecisionOutcome;
      let evaluated: string;
      if (source === 'file') {
        const xml = await getModel();
        evaluated = decisionId;
        outcome = await client.devEvaluateDecision({ dmn: xml, decisionRef: decisionId, inputs });
      } else {
        evaluated = reference;
        outcome = await client.devEvaluateDecision({ deploymentId, decisionRef: reference, inputs });
      }
      const next = { decisionId: evaluated, outcome };
      setResult(next);
      onOutcome(source === 'file' ? next : undefined);
    } catch (e) {
      setResult(undefined);
      onOutcome(undefined);
      setError(describeFailure(e, info));
    } finally {
      setBusy(false);
    }
  };

  const loadDeployments = async (): Promise<void> => {
    setError(undefined);
    try {
      if (conn.status !== 'connected') {
        setError('Not connected to a modeler server. Connect first (Run > Connect to server), then load the deployments.');
        runService.openConnectionDialog();
        return;
      }
      const page = await connection.require().listDeployments({ size: 50 });
      setDeployments(page.items.map((d) => ({ id: d.id, ...(d.name ? { name: d.name } : {}) })));
    } catch (e) {
      setError(describeFailure(e, info));
    }
  };

  const rows = useMemo(() => result?.outcome.rows ?? [], [result]);
  const columns = columnsOf(rows);

  return (
    <aside className="decision-tester" data-testid="decision-tester" aria-label="Decision tester">
      <header>
        <strong>Test decision</strong>
        <button type="button" className="btn" onClick={close} aria-label="Close the decision tester" data-testid="tester-close">
          Close
        </button>
      </header>
      <div className="tester-body">
        <div className="tester-mode" role="radiogroup" aria-label="What to evaluate">
          <label>
            <input type="radio" name="tester-source" checked={source === 'file'} onChange={() => setSource('file')} data-testid="tester-source-file" /> This file, as edited
          </label>
          <label>
            <input type="radio" name="tester-source" checked={source === 'deployment'} onChange={() => setSource('deployment')} data-testid="tester-source-deployment" /> A deployment
          </label>
        </div>

        {source === 'file' ? (
          <>
            {model.error && <p role="alert" className="tester-error">The model cannot be read: {model.error}</p>}
            <label className="tester-field">
              <span>Decision</span>
              <select value={decisionId} onChange={(e) => setDecisionId(e.target.value)} data-testid="tester-decision" disabled={model.decisions.length === 0}>
                {model.decisions.length === 0 && <option value="">(no decision in this file)</option>}
                {model.decisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name ? `${d.name} (${d.id})` : d.id}
                  </option>
                ))}
              </select>
            </label>
            {decision && decision.kind !== 'table' && decision.kind !== 'literal' && <p className="muted tester-note">This decision is a {decision.kind === 'empty' ? 'decision without logic' : `boxed ${decision.kind}`}: only the KIE engine evaluates it.</p>}
            {decision && decision.inputs.length === 0 && <p className="muted tester-note">This decision needs no input.</p>}
            {decision?.inputs.map((input) => (
              <label className="tester-field" key={input.name}>
                <span>
                  {input.name} <small className="muted">{input.type}</small>
                </span>
                {input.allowedValues ? (
                  <select value={values[input.name] ?? ''} onChange={(e) => update(input.name, e.target.value)} data-testid={`tester-input-${input.name}`}>
                    <option value="">(not set)</option>
                    {input.allowedValues.map((v) => (
                      <option key={v} value={literalText(v)}>
                        {literalText(v)}
                      </option>
                    ))}
                  </select>
                ) : input.type === 'boolean' ? (
                  <select value={values[input.name] ?? ''} onChange={(e) => update(input.name, e.target.value)} data-testid={`tester-input-${input.name}`}>
                    <option value="">(not set)</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input type="text" value={values[input.name] ?? ''} onChange={(e) => update(input.name, e.target.value)} placeholder={input.type === 'number' ? '0' : input.type === 'date' ? '2026-10-27' : ''} data-testid={`tester-input-${input.name}`} />
                )}
              </label>
            ))}
          </>
        ) : (
          <>
            <div className="tester-field">
              <span>Deployment</span>
              <div className="tester-inline">
                <select value={deploymentId} onChange={(e) => setDeploymentId(e.target.value)} data-testid="tester-deployment">
                  <option value="">(load the deployments)</option>
                  {deployments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name ?? d.id}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn" onClick={() => void loadDeployments()} data-testid="tester-load-deployments">
                  Load
                </button>
              </div>
            </div>
            <label className="tester-field">
              <span>Decision id, file or model name</span>
              <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} data-testid="tester-reference" />
            </label>
            <label className="tester-field">
              <span>Inputs as JSON</span>
              <textarea
                rows={3}
                value={values['__json'] ?? ''}
                onChange={(e) => {
                  const text = e.target.value;
                  try {
                    const parsed = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
                    setValues(Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])));
                  } catch {
                    // typed so far is not JSON yet
                  }
                }}
                data-testid="tester-json"
              />
            </label>
          </>
        )}

        <div className="tester-server" data-testid="tester-server">
          <span className="muted" data-testid="tester-server-summary">{conn.status === 'connected' ? connection.summary() : 'Not connected to a modeler server'}</span>{' '}
          <button type="button" className="btn" onClick={() => runService.openConnectionDialog()} data-testid="tester-connect">
            {conn.status === 'connected' ? 'Server...' : 'Connect...'}
          </button>
        </div>

        <div className="tester-actions">
          <button type="button" className="btn primary" onClick={() => void evaluate()} disabled={busy || (source === 'file' ? !decision : !deploymentId || !reference)} data-testid="tester-evaluate">
            {busy ? 'Evaluating…' : 'Evaluate'}
          </button>
        </div>

        {error && (
          <p role="alert" className="tester-error" data-testid="tester-error">
            {error}
          </p>
        )}

        {result && (
          <section className="tester-result" data-testid="tester-result" aria-label="Result">
            <p data-testid="tester-matched">
              {result.outcome.matched ? 'A rule matched' : 'No rule matched'} <small className="muted">({result.outcome.engine})</small>
            </p>
            {rows.length > 0 ? (
              <table className="tester-rows" data-testid="tester-rows">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c}>{c in row ? show(row[c]) : ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted" data-testid="tester-no-rows">No result row.</p>
            )}
            <p>
              Matched rules:{' '}
              {result.outcome.matchedRules.length === 0 ? (
                <span className="muted">none</span>
              ) : (
                <span data-testid="tester-matched-rules">{result.outcome.matchedRules.join(', ')}</span>
              )}
            </p>
            {result.outcome.decisions.length > 1 && (
              <details open>
                <summary>Decisions on the way ({result.outcome.decisions.length})</summary>
                <ul className="tester-steps" data-testid="tester-steps">
                  {result.outcome.decisions.map((step) => (
                    <li key={step.decisionId}>
                      <strong>{step.decisionName ?? step.decisionId}</strong> <small className="muted">{step.kind}{step.hitPolicy ? `, ${step.hitPolicy}` : ''}</small>: {step.rows.length === 0 ? 'no row' : step.rows.map((r) => show(r)).join('; ')}
                      {step.matchedRules.length > 0 && <small className="muted"> (rules {step.matchedRules.join(', ')})</small>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
