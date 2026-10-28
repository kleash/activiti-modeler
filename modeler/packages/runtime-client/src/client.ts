import { basicAuth } from './auth';
import type * as T from './generated/types';
import type { OperationId } from './generated/operations';
import { Transport, type CallArguments, type RuntimeClientOptions } from './http';

/** Paging of every list: `page` starts at 0. */
export interface PageQuery {
  page?: number;
  size?: number;
}

/** The last argument of every call. */
export interface CallOptions {
  signal?: AbortSignal;
}

/** Instance states the list can be filtered by. */
export type InstanceStateFilter = 'all' | 'running' | 'active' | 'suspended' | 'finished' | 'completed' | 'cancelled';

export type JobKind = 'JOB' | 'TIMER' | 'SUSPENDED' | 'DEADLETTER';

/** Which operation each client method calls (the unit test checks that every operation of the API has a method). */
export const OPERATION_METHODS = {
  getEngine: 'getEngine',
  getHealth: 'getHealth',
  listDeployments: 'listDeployments',
  getDeployment: 'getDeployment',
  listDeploymentResources: 'listDeploymentResources',
  getDeploymentResource: 'getDeploymentResource',
  listProcessDefinitions: 'listProcessDefinitions',
  getProcessDefinition: 'getProcessDefinition',
  getProcessDefinitionXml: 'getProcessDefinitionXml',
  getProcessDefinitionExtensions: 'getProcessDefinitionExtensions',
  getProcessDefinitionDecisions: 'getProcessDefinitionDecisions',
  suspendProcessDefinition: 'suspendProcessDefinition',
  activateProcessDefinition: 'activateProcessDefinition',
  startProcessInstance: 'startProcessInstance',
  listProcessInstances: 'listProcessInstances',
  getProcessInstance: 'getProcessInstance',
  getProcessInstancePath: 'getProcessInstancePath',
  getProcessInstanceVariables: 'getProcessInstanceVariables',
  getProcessInstanceVariableHistory: 'getProcessInstanceVariableHistory',
  setProcessInstanceVariables: 'setProcessInstanceVariables',
  removeProcessInstanceVariables: 'removeProcessInstanceVariables',
  suspendProcessInstance: 'suspendProcessInstance',
  activateProcessInstance: 'activateProcessInstance',
  deleteProcessInstance: 'deleteProcessInstance',
  listTasks: 'listTasks',
  getTask: 'getTask',
  claimTask: 'claimTask',
  releaseTask: 'releaseTask',
  assignTask: 'assignTask',
  completeTask: 'completeTask',
  sendMessage: 'sendMessage',
  sendSignal: 'sendSignal',
  triggerExecution: 'triggerExecution',
  listJobs: 'listJobs',
  getJob: 'getJob',
  executeJob: 'executeJob',
  setJobRetries: 'setJobRetries',
  fireTimer: 'fireTimer',
  retryDeadLetterJob: 'retryDeadLetterJob',
  devValidate: 'devValidate',
  devDeploy: 'devDeploy',
  devDeleteDeployment: 'devDeleteDeployment',
  devRunScenario: 'devRunScenario',
  devEvaluateDecision: 'devEvaluateDecision',
  devWorkspaceRoot: 'devWorkspaceRoot',
  devWorkspaceGet: 'readWorkspaceDirectory',
  devWorkspacePut: 'writeWorkspaceFile',
  devWorkspaceDelete: 'deleteWorkspacePath',
  devMailList: 'devMailList',
  devMailPurge: 'devMailPurge',
} as const satisfies Record<OperationId, string>;

/**
 * Typed client for the runtime REST API: the core endpoints, the dev endpoints of the modeler server and its own (`health`, `mail`).
 * One method per operation; the types are generated from the OpenAPI description the Java build publishes
 * (docs/api/openapi-*.json).
 *
 * ```ts
 * const client = new RuntimeClient({ baseUrl: 'http://localhost:8080', auth: basicAuth('modeler', 'modeler') });
 * const instance = await client.startProcessInstance({ processKey: 'order', variables: { amount: 5000 } });
 * ```
 *
 * Errors: {@link RuntimeApiError} for an error status (with the server's problem document), {@link RuntimeNetworkError} when there
 * was no answer.
 */
export class RuntimeClient {
  private readonly transport: Transport;

  constructor(options: RuntimeClientOptions = {}) {
    this.transport = new Transport(options, basicAuth);
  }

  /** The URL an operation is sent to (for links, tests and debugging). */
  urlOf(operation: OperationId, args?: CallArguments): string {
    return this.transport.urlOf(operation, args);
  }

  private call<R>(operation: OperationId, args: CallArguments = {}, options: CallOptions = {}): Promise<R> {
    return this.transport.call(operation, options.signal ? { ...args, signal: options.signal } : args) as Promise<R>;
  }

  // ---- engine and server -------------------------------------------------------------------------------------------------------

  /** Versions, history level, async executor, DMN engine, connector and bean names, script engines. */
  getEngine(options?: CallOptions): Promise<T.EngineInfo> {
    return this.call('getEngine', {}, options);
  }

  /** Alias of {@link getEngine}. */
  engine(options?: CallOptions): Promise<T.EngineInfo> {
    return this.getEngine(options);
  }

  /** Is the modeler server there? Needs no credentials. */
  getHealth(options?: CallOptions): Promise<T.Health> {
    return this.call('getHealth', {}, options);
  }

  // ---- deployments and definitions ------------------------------------------------------------------------------------------

  listDeployments(query: PageQuery & { nameLike?: string } = {}, options?: CallOptions): Promise<T.PageDtoDeployment> {
    return this.call('listDeployments', { query }, options);
  }

  getDeployment(id: string, options?: CallOptions): Promise<T.Deployment> {
    return this.call('getDeployment', { path: { id } }, options);
  }

  listDeploymentResources(id: string, options?: CallOptions): Promise<T.DeploymentResource[]> {
    return this.call('listDeploymentResources', { path: { id } }, options);
  }

  /** The content of one resource of a deployment, as text. */
  getDeploymentResource(id: string, name: string, options?: CallOptions): Promise<string> {
    return this.call('getDeploymentResource', { path: { id }, query: { name } }, options);
  }

  listProcessDefinitions(
    query: PageQuery & { key?: string; nameLike?: string; latest?: boolean; deploymentId?: string; suspended?: boolean; includeCounts?: boolean } = {},
    options?: CallOptions,
  ): Promise<T.PageDtoProcessDefinition> {
    return this.call('listProcessDefinitions', { query }, options);
  }

  /** One definition, by id or by key (its latest version). */
  getProcessDefinition(idOrKey: string, query: { includeCounts?: boolean } = {}, options?: CallOptions): Promise<T.ProcessDefinition> {
    return this.call('getProcessDefinition', { path: { id: idOrKey }, query }, options);
  }

  /** The BPMN XML of a definition. */
  getProcessDefinitionXml(idOrKey: string, options?: CallOptions): Promise<string> {
    return this.call('getProcessDefinitionXml', { path: { id: idOrKey } }, options);
  }

  getProcessDefinitionExtensions(idOrKey: string, options?: CallOptions): Promise<T.DefinitionExtensions> {
    return this.call('getProcessDefinitionExtensions', { path: { id: idOrKey } }, options);
  }

  getProcessDefinitionDecisions(idOrKey: string, options?: CallOptions): Promise<T.DefinitionDecisions> {
    return this.call('getProcessDefinitionDecisions', { path: { id: idOrKey } }, options);
  }

  suspendProcessDefinition(idOrKey: string, options?: CallOptions): Promise<void> {
    return this.call('suspendProcessDefinition', { path: { id: idOrKey } }, options);
  }

  activateProcessDefinition(idOrKey: string, options?: CallOptions): Promise<void> {
    return this.call('activateProcessDefinition', { path: { id: idOrKey } }, options);
  }

  // ---- process instances ----------------------------------------------------------------------------------------------------

  /** Start an instance as the authenticated user: give `processKey`, `processDefinitionId` or `messageName`. */
  startProcessInstance(request: T.StartRequest, options?: CallOptions): Promise<T.InstanceDetail> {
    return this.call('startProcessInstance', { body: request }, options);
  }

  listProcessInstances(
    query: PageQuery & {
      state?: InstanceStateFilter;
      definitionKey?: string;
      definitionId?: string;
      businessKey?: string;
      startedBy?: string;
      parentId?: string;
    } = {},
    options?: CallOptions,
  ): Promise<T.PageDtoInstanceSummary> {
    return this.call('listProcessInstances', { query }, options);
  }

  getProcessInstance(id: string, options?: CallOptions): Promise<T.InstanceDetail> {
    return this.call('getProcessInstance', { path: { id } }, options);
  }

  getProcessInstancePath(id: string, options?: CallOptions): Promise<T.InstancePath> {
    return this.call('getProcessInstancePath', { path: { id } }, options);
  }

  getProcessInstanceVariables(id: string, options?: CallOptions): Promise<T.InstanceVariable[]> {
    return this.call('getProcessInstanceVariables', { path: { id } }, options);
  }

  getProcessInstanceVariableHistory(id: string, options?: CallOptions): Promise<T.InstanceVariableUpdate[]> {
    return this.call('getProcessInstanceVariableHistory', { path: { id } }, options);
  }

  setProcessInstanceVariables(id: string, variables: Record<string, unknown>, options?: CallOptions): Promise<void> {
    return this.call('setProcessInstanceVariables', { path: { id }, body: { variables } satisfies T.VariablesRequest }, options);
  }

  removeProcessInstanceVariables(id: string, names: string[], options?: CallOptions): Promise<void> {
    return this.call('removeProcessInstanceVariables', { path: { id }, query: { name: names } }, options);
  }

  suspendProcessInstance(id: string, options?: CallOptions): Promise<void> {
    return this.call('suspendProcessInstance', { path: { id } }, options);
  }

  activateProcessInstance(id: string, options?: CallOptions): Promise<void> {
    return this.call('activateProcessInstance', { path: { id } }, options);
  }

  /** Cancels a running instance; `purgeHistory` (admin only) deletes the history of an ended one instead. */
  deleteProcessInstance(id: string, query: { reason?: string; purgeHistory?: boolean } = {}, options?: CallOptions): Promise<void> {
    return this.call('deleteProcessInstance', { path: { id }, query }, options);
  }

  // ---- tasks ------------------------------------------------------------------------------------------------------------------

  listTasks(
    query: PageQuery & {
      processInstanceId?: string;
      assignee?: string;
      candidateUser?: string;
      candidateGroup?: string;
      unassigned?: boolean;
      nameLike?: string;
      taskDefinitionKey?: string;
      /** Only the tasks the authenticated user sees through TaskRuntime. */
      mine?: boolean;
      candidates?: boolean;
      variables?: boolean;
    } = {},
    options?: CallOptions,
  ): Promise<T.PageDtoTask> {
    return this.call('listTasks', { query }, options);
  }

  getTask(id: string, options?: CallOptions): Promise<T.Task> {
    return this.call('getTask', { path: { id } }, options);
  }

  /** Claim for the authenticated user. */
  claimTask(id: string, options?: CallOptions): Promise<T.Task> {
    return this.call('claimTask', { path: { id } }, options);
  }

  releaseTask(id: string, options?: CallOptions): Promise<T.Task> {
    return this.call('releaseTask', { path: { id } }, options);
  }

  assignTask(id: string, assignee: string, options?: CallOptions): Promise<T.Task> {
    return this.call('assignTask', { path: { id }, body: { assignee } satisfies T.AssignRequest }, options);
  }

  /** Complete a task the authenticated user has claimed. */
  completeTask(id: string, variables?: Record<string, unknown>, options?: CallOptions): Promise<void> {
    return this.call('completeTask', { path: { id }, body: { variables } satisfies T.CompleteRequest }, options);
  }

  // ---- events -----------------------------------------------------------------------------------------------------------------

  sendMessage(request: T.MessageRequest, options?: CallOptions): Promise<T.Delivered> {
    return this.call('sendMessage', { body: request }, options);
  }

  sendSignal(request: T.SignalRequest, options?: CallOptions): Promise<T.Delivered> {
    return this.call('sendSignal', { body: request }, options);
  }

  /** Trigger an execution that waits at a receive task. */
  triggerExecution(executionId: string, variables?: Record<string, unknown>, options?: CallOptions): Promise<T.Delivered> {
    return this.call('triggerExecution', { path: { id: executionId }, body: { variables } satisfies T.TriggerRequest }, options);
  }

  // ---- jobs -------------------------------------------------------------------------------------------------------------------

  listJobs(
    query: PageQuery & { kind?: JobKind; processInstanceId?: string; withException?: boolean } = {},
    options?: CallOptions,
  ): Promise<T.PageDtoJob> {
    return this.call('listJobs', { query }, options);
  }

  /** A job in whichever table it is, with the stack trace of its last failure. */
  getJob(id: string, options?: CallOptions): Promise<T.JobDetail> {
    return this.call('getJob', { path: { id } }, options);
  }

  executeJob(id: string, options?: CallOptions): Promise<void> {
    return this.call('executeJob', { path: { id } }, options);
  }

  setJobRetries(id: string, retries: number, options?: CallOptions): Promise<void> {
    return this.call('setJobRetries', { path: { id }, body: { retries } satisfies T.RetriesRequest }, options);
  }

  /** Fire a timer now (moveTimerToExecutableJob, then executeJob). */
  fireTimer(timerJobId: string, options?: CallOptions): Promise<T.FireResult> {
    return this.call('fireTimer', { path: { id: timerJobId } }, options);
  }

  /** Move a dead-letter job back to the executable table, optionally executing it right away. */
  retryDeadLetterJob(id: string, request: T.DeadLetterRetryRequest = {}, options?: CallOptions): Promise<T.Job> {
    return this.call('retryDeadLetterJob', { path: { id }, body: request }, options);
  }

  // ---- dev endpoints (modeler server) -----------------------------------------------------------------------------------------

  /** Check a project: BPMN XSD, engine validators, trial deployment, extensions JSON, DMN. */
  devValidate(files: T.FileEntry[], options?: CallOptions): Promise<T.ValidateResponse> {
    return this.call('devValidate', { body: { files } satisfies T.ValidateRequest }, options);
  }

  /** Deploy the files as one deployment; refused with a 422 {@link RuntimeApiError} (whose `problems` are the findings) on errors. */
  devDeploy(files: T.FileEntry[], name?: string, options?: CallOptions): Promise<T.DeployResponse> {
    return this.call('devDeploy', { body: { name, files } satisfies T.DeployRequest }, options);
  }

  devDeleteDeployment(id: string, query: { cascade?: boolean } = {}, options?: CallOptions): Promise<void> {
    return this.call('devDeleteDeployment', { path: { id }, query }, options);
  }

  /** Run a scenario file (an object or its text) against the files on the server's engine; the report says what passed. */
  devRunScenario(files: T.FileEntry[], scenario: unknown, options?: CallOptions): Promise<T.ScenarioRunResponse> {
    return this.call('devRunScenario', { body: { files, scenario } satisfies T.ScenarioRunRequest }, options);
  }

  devEvaluateDecision(request: T.DecisionRequest, options?: CallOptions): Promise<T.DecisionOutcome> {
    return this.call('devEvaluateDecision', { body: request }, options);
  }

  /** The listing of the workspace root. */
  devWorkspaceRoot(query: { recursive?: boolean } = {}, options?: CallOptions): Promise<T.WorkspaceListing> {
    return this.call('devWorkspaceRoot', { query }, options);
  }

  /** The listing of a workspace directory. */
  readWorkspaceDirectory(path: string, query: { recursive?: boolean } = {}, options?: CallOptions): Promise<T.WorkspaceListing> {
    return this.call('devWorkspaceGet', { path: { path }, query }, options);
  }

  /** The text of a workspace file. */
  readWorkspaceFile(path: string, options?: CallOptions): Promise<string> {
    return this.call('devWorkspaceGet', { path: { path }, asText: true }, options);
  }

  /** Create or replace a workspace file. */
  writeWorkspaceFile(path: string, content: string | Uint8Array, options?: CallOptions & { contentType?: string }): Promise<void> {
    const contentType = options?.contentType ?? contentTypeOf(path);
    return this.call('devWorkspacePut', { path: { path }, raw: { content, contentType } }, options);
  }

  deleteWorkspacePath(path: string, query: { recursive?: boolean } = {}, options?: CallOptions): Promise<void> {
    return this.call('devWorkspaceDelete', { path: { path }, query }, options);
  }

  /** Messages the mail tasks sent to the embedded SMTP server. */
  devMailList(options?: CallOptions): Promise<T.Mailbox> {
    return this.call('devMailList', {}, options);
  }

  devMailPurge(options?: CallOptions): Promise<void> {
    return this.call('devMailPurge', {}, options);
  }
}

function contentTypeOf(path: string): string {
  const name = path.toLowerCase();
  if (name.endsWith('.json')) {
    return 'application/json';
  }
  if (name.endsWith('.xml') || name.endsWith('.bpmn') || name.endsWith('.dmn')) {
    return 'application/xml';
  }
  return 'text/plain';
}
