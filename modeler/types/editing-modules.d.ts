// Modules of the editing features without bundled type declarations: didi modules passed as `additionalModules`, and small libraries.

declare module 'bpmn-js-create-append-anything' {
  export const CreateAppendAnythingModule: { __depends__?: unknown[]; __init__?: string[]; [service: string]: unknown };
  export const CreateAppendElementTemplatesModule: { __depends__?: unknown[]; [service: string]: unknown };
}

declare module 'bpmn-js-color-picker' {
  const module: { __init__: string[]; [service: string]: unknown };
  export default module;
}

declare module '@bpmn-io/variable-resolver/lib/base/VariableResolver' {
  /** The base class of the variable resolvers of `@bpmn-io/variable-resolver`; subclasses set `_baseExtractor` and `_getScope`. */
  export class BaseVariableResolver {
    constructor(eventBus: unknown, bpmnjs: unknown);
    providers: unknown[];
    _baseExtractor: (container: unknown, additionalExtractors: unknown[]) => Promise<unknown[]>;
    _getScope: (element: unknown, container: unknown, name: string, includeSelf?: boolean) => unknown;
    getVariables(): Promise<Record<string, ResolverVariable[]>>;
    getRawVariables(): Promise<Record<string, ResolverVariable[]>>;
    getProcessVariables(element: unknown): Promise<ResolverVariable[]>;
    getVariablesForElement(element: unknown, options?: { read?: boolean; written?: boolean; local?: boolean; external?: boolean; outputMappings?: boolean }): Promise<ResolverVariable[]>;
    invalidateCache(): void;
    registerProvider(provider: unknown): void;
  }
  export interface ResolverVariable {
    name: string;
    type?: string;
    info?: string;
    detail?: string;
    origin?: unknown[];
    usedBy?: unknown[];
    scope?: { id?: string };
    [extra: string]: unknown;
  }
}

declare module 'bpmn-auto-layout' {
  /** Adds a diagram (shapes and edges) to a BPMN 2.0 XML document that has none. */
  export function layoutProcess(xml: string): Promise<string>;
}

declare module 'dmn-js-properties-panel' {
  export const DmnPropertiesPanelModule: { __depends__?: unknown[]; __init__?: string[]; [service: string]: unknown };
  export const DmnPropertiesProviderModule: { __depends__?: unknown[]; __init__?: string[]; [service: string]: unknown };
}
