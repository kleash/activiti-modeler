// bpmnlint, bpmn-js-bpmnlint and bpmnlint-utils ship CommonJS without (usable) declarations for the parts the modeler uses.

declare module 'bpmnlint' {
  export interface BpmnlintResolver {
    resolveRule(pkg: string, ruleName: string): unknown;
    resolveConfig(pkg: string, configName: string): unknown;
  }
  export interface LinterConfig {
    extends?: string | string[];
    rules?: Record<string, string | [string, unknown?]>;
  }
  export interface BpmnlintReport {
    id?: string;
    message: string;
    path?: string[];
    category: string;
    meta?: { documentation?: { url?: string } };
    [extra: string]: unknown;
  }
  export class Linter {
    constructor(options: { config?: LinterConfig; resolver: BpmnlintResolver; transformRule?: (rule: unknown, options: { pkg: string; ruleName: string }) => unknown });
    lint(moddleRoot: unknown, config?: LinterConfig): Promise<Record<string, BpmnlintReport[]>>;
    resolveRules(config: LinterConfig): Promise<Array<{ name: string; category: string; rule: unknown }>>;
  }
}

declare module 'bpmnlint/lib/resolver/static-resolver' {
  import type { BpmnlintResolver } from 'bpmnlint';
  export default class StaticResolver implements BpmnlintResolver {
    constructor(cache: Record<string, unknown>);
    resolveRule(pkg: string, ruleName: string): unknown;
    resolveConfig(pkg: string, configName: string): unknown;
  }
}

declare module 'bpmnlint/rules/*' {
  const rule: (config?: unknown) => { check: unknown; meta?: unknown };
  export default rule;
}

declare module 'bpmnlint/config/*' {
  const config: { rules: Record<string, string> };
  export default config;
}

declare module 'bpmn-js-bpmnlint' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css';
