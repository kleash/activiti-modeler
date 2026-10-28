/**
 * `window.__modelerLint`: lets the Playwright tests drive the lint service without a modeler server (a mock server
 * validator) and run the deploy gate. Built into dev and test builds only (see main.tsx).
 */
import type { Problem, ServerProblem } from '@activiti-modeler/bpmnlint-plugin-activiti';

import { lintService } from './LintService';

export interface LintTestHook {
  /** Waits for the project lint to finish and returns all problems. */
  problems(): Promise<Problem[]>;
  /** Connects a validator that answers with `problems` (and records the files it was sent). */
  connectMockServer(problems: ServerProblem[], options?: { asyncExecutorActive?: boolean }): void;
  sentFiles(): string[];
  disconnectServer(): void;
  /** The gate a deployment passes. */
  checkDeployable(): Promise<{ deployable: boolean; problems: Problem[]; counts: { error: number; warning: number; info: number } }>;
}

declare global {
  interface Window {
    __modelerLint?: LintTestHook;
  }
}

export function installLintTestHook(): void {
  let sent: string[] = [];
  window.__modelerLint = {
    problems: async () => (await lintService.refresh()).problems,
    connectMockServer(problems, options = {}) {
      lintService.setServerValidator({
        async validate(files) {
          sent = files.map((f) => f.path);
          return { problems, asyncExecutorActive: options.asyncExecutorActive ?? true, valid: !problems.some((p) => p.severity === 'error') };
        },
      });
    },
    sentFiles: () => sent,
    disconnectServer: () => lintService.setServerValidator(undefined),
    checkDeployable: () => lintService.checkDeployable(),
  };
}
