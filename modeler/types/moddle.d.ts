// bpmn-moddle and dmn-moddle ship no declaration for their factory classes; this covers what the modeler uses.

interface ModdleDescriptorProperty {
  name: string;
  type: string;
  isAttr?: boolean;
  isMany?: boolean;
  isReference?: boolean;
  isBody?: boolean;
  ns: { name: string; prefix: string; localName: string };
}

declare module 'bpmn-moddle' {
  export interface ModdleElement {
    $type: string;
    $parent?: ModdleElement;
    $attrs: Record<string, string>;
    $descriptor: { name: string; properties: ModdleDescriptorProperty[]; propertiesByName: Record<string, ModdleDescriptorProperty> };
    $instanceOf(type: string): boolean;
    id?: string;
    get(name: string): unknown;
    set(name: string, value: unknown): void;
    [property: string]: unknown;
  }

  export interface ModdleWarning {
    message: string;
    element?: ModdleElement;
    property?: string;
    value?: string;
  }

  export interface ModdleImportResult {
    rootElement: ModdleElement;
    references: unknown[];
    warnings: ModdleWarning[];
    elementsById: Record<string, ModdleElement>;
  }

  export interface ModdleExportResult {
    xml: string;
  }

  export interface ModdleDescriptorSource {
    name: string;
    uri: string;
    prefix: string;
    xml?: { tagAlias?: string };
    types: readonly unknown[];
    [key: string]: unknown;
  }

  export class BpmnModdle {
    constructor(packages?: Record<string, ModdleDescriptorSource>);
    create(type: string, attrs?: Record<string, unknown>): ModdleElement;
    getType(type: string): unknown;
    getElementDescriptor(element: ModdleElement): ModdleElement['$descriptor'];
    getTypeDescriptor(type: string): ModdleElement['$descriptor'];
    fromXML(xml: string, typeName?: string | Record<string, unknown>, options?: Record<string, unknown>): Promise<ModdleImportResult>;
    toXML(element: ModdleElement, options?: { format?: boolean; preamble?: boolean }): Promise<ModdleExportResult>;
  }
}

declare module 'dmn-moddle' {
  import type { ModdleDescriptorSource, ModdleElement, ModdleExportResult, ModdleImportResult } from 'bpmn-moddle';

  export class DmnModdle {
    constructor(packages?: Record<string, ModdleDescriptorSource>);
    create(type: string, attrs?: Record<string, unknown>): ModdleElement;
    fromXML(xml: string, typeName?: string | Record<string, unknown>, options?: Record<string, unknown>): Promise<ModdleImportResult>;
    toXML(element: ModdleElement, options?: { format?: boolean }): Promise<ModdleExportResult>;
  }
}
