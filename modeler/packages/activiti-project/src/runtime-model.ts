/**
 * The fields of `<name>-extensions.json` that the Activiti 9.0.0 runtime can read (ADR 0003, "Extensions rules").
 *
 * The runtime deserialises the file into `org.activiti.spring.process.model.ProcessExtensionModel` with the host's
 * `ObjectMapper` bean. Spring Boot's JSON auto-configuration turns off FAIL_ON_UNKNOWN_PROPERTIES, a host without it
 * gets a plain mapper that throws `UnrecognizedPropertyException` on any other field. The modeler therefore writes
 * only the fields below and drops everything else on export (reporting it as a warning).
 *
 * Each shape cites the Java class and the bean properties it was read from (the JavaBean getters and setters of
 * activiti-spring-process-extensions 9.0.0 and activiti-connector-model 9.0.0). `Object`-typed Java fields (`value`)
 * hold arbitrary JSON and are not looked into. runtime-model.test.ts keeps this list honest: it fails when a field is
 * written that is not listed here, and, when `ACTIVITI_MODEL_SOURCES` points to the unpacked 9.0.0 source jars, when
 * a listed shape no longer matches the Java class.
 */

/** A value Jackson reads into `Object`: any JSON. */
export const FREE = 'free' as const;

export interface ObjectShape {
  kind: 'object';
  /** Fully qualified Java class, for the citation. */
  javaClass: string;
  /** Property name -> shape of its value. */
  fields: { readonly [property: string]: Shape };
}

export interface MapShape {
  kind: 'map';
  /** Java type of the map, for the citation. */
  javaType: string;
  /** Shape of the values; keys are free (process ids, property ids, element ids, mapping names). */
  value: Shape;
}

export type Shape = ObjectShape | MapShape | typeof FREE;

const SPRING = 'org.activiti.spring.process.model';

const object = (javaClass: string, fields: ObjectShape['fields']): ObjectShape => ({ kind: 'object', javaClass, fields });
const map = (javaType: string, value: Shape): MapShape => ({ kind: 'map', javaType, value });

/** `VariableDefinition extends org.activiti.core.common.model.connector.VariableDefinition`: id, name, description, type, required, display, displayName, analytics, ephemeral and, in the subclass, value. */
const VARIABLE_DEFINITION = object(`${SPRING}.VariableDefinition`, {
  id: FREE,
  name: FREE,
  description: FREE,
  type: FREE,
  required: FREE,
  display: FREE,
  displayName: FREE,
  analytics: FREE,
  ephemeral: FREE,
  value: FREE,
});

/** `Mapping`: type (enum SourceMappingType VARIABLE, VALUE, JSONPATCH) and value (Object). */
const MAPPING = object(`${SPRING}.Mapping`, { type: FREE, value: FREE });

/** `ProcessVariablesMapping`: mappingType (enum MappingType), inputs, outputs, ephemeral. */
const PROCESS_VARIABLES_MAPPING = object(`${SPRING}.ProcessVariablesMapping`, {
  mappingType: FREE,
  inputs: map('Map<String, Mapping>', MAPPING),
  outputs: map('Map<String, Mapping>', MAPPING),
  ephemeral: FREE,
});

/** `ProcessConstantsMapping extends HashMap<String, ConstantDefinition>`; `ConstantDefinition`: value (Object). */
const PROCESS_CONSTANTS_MAPPING = map('ProcessConstantsMapping', object(`${SPRING}.ConstantDefinition`, { value: FREE }));

/** `TemplateDefinition`: from, subject, type (enum TemplateType VARIABLE, FILE), value. */
const TEMPLATE_DEFINITION = object(`${SPRING}.TemplateDefinition`, { from: FREE, subject: FREE, type: FREE, value: FREE });

/** `TaskTemplateDefinition`: assignee, candidate, emailNotificationEnabled (isEmailNotificationEnabled()). */
const TASK_TEMPLATE_DEFINITION = object(`${SPRING}.TaskTemplateDefinition`, {
  assignee: TEMPLATE_DEFINITION,
  candidate: TEMPLATE_DEFINITION,
  emailNotificationEnabled: FREE,
});

/** `TemplatesDefinition`: tasks, and defaultTemplate which is serialised as "default" (@JsonProperty). */
const TEMPLATES_DEFINITION = object(`${SPRING}.TemplatesDefinition`, {
  tasks: map('Map<String, TaskTemplateDefinition>', TASK_TEMPLATE_DEFINITION),
  default: TASK_TEMPLATE_DEFINITION,
});

/** `AssignmentDefinition`: id, assignment (ASSIGNEE, CANDIDATES), type (STATIC, IDENTITY, EXPRESSION), mode (SEQUENTIAL, MANUAL). */
const ASSIGNMENT_DEFINITION = object(`${SPRING}.AssignmentDefinition`, { id: FREE, assignment: FREE, type: FREE, mode: FREE });

/** `Extension`: properties, mappings, constants, templates, assignments. */
const EXTENSION = object(`${SPRING}.Extension`, {
  properties: map('Map<String, VariableDefinition>', VARIABLE_DEFINITION),
  mappings: map('Map<String, ProcessVariablesMapping>', PROCESS_VARIABLES_MAPPING),
  constants: map('Map<String, ProcessConstantsMapping>', PROCESS_CONSTANTS_MAPPING),
  templates: TEMPLATES_DEFINITION,
  assignments: map('Map<String, AssignmentDefinition>', ASSIGNMENT_DEFINITION),
});

/** `ProcessExtensionModel`: id and extensions (the setter; `getAllExtensions` is a read-only view). */
export const RUNTIME_MODEL: ObjectShape = object(`${SPRING}.ProcessExtensionModel`, {
  id: FREE,
  extensions: map('Map<String, Extension>', EXTENSION),
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const pathOf = (parent: string, key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`);

/** Every object shape of the model with the JSON path pattern it is reached by, for tests and documentation. */
export function listShapes(shape: Shape = RUNTIME_MODEL, path = '$'): Array<{ path: string; javaClass: string; fields: string[] }> {
  if (shape === FREE) return [];
  if (shape.kind === 'map') return listShapes(shape.value, `${path}.*`);
  const out = [{ path, javaClass: shape.javaClass, fields: Object.keys(shape.fields) }];
  for (const [name, child] of Object.entries(shape.fields)) out.push(...listShapes(child, `${path}.${name}`));
  return out;
}

function walk(value: unknown, shape: Shape, path: string, visit: (path: string) => void): unknown {
  if (shape === FREE) return value;
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  if (shape.kind === 'map') {
    for (const [key, child] of Object.entries(value)) result[key] = walk(child, shape.value, pathOf(path, key), visit);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    const known = Object.prototype.hasOwnProperty.call(shape.fields, key);
    if (!known) {
      visit(pathOf(path, key));
      continue;
    }
    result[key] = walk(child, shape.fields[key]!, pathOf(path, key), visit);
  }
  return result;
}

/** JSON paths of the fields the Activiti 9.0.0 runtime does not know (it would reject or ignore them). */
export function findUnknownFields(document: unknown): string[] {
  const found: string[] = [];
  walk(document, RUNTIME_MODEL, '$', (path) => found.push(path));
  return found;
}

/** A copy of the document without the fields the runtime does not know, and the paths that were dropped. */
export function stripUnknownFields<T>(document: T): { document: T; dropped: string[] } {
  const dropped: string[] = [];
  const stripped = walk(document, RUNTIME_MODEL, '$', (path) => dropped.push(path)) as T;
  return { document: stripped, dropped };
}

/** The warning text for a dropped field, shared by import and export. */
export function unknownFieldWarning(file: string, path: string, phase: 'import' | 'export'): string {
  return phase === 'import'
    ? `${file}: field ${path} is not known to Activiti ${RUNTIME_VERSION} and will be dropped on export`
    : `${file}: dropped field ${path}, which Activiti ${RUNTIME_VERSION} does not know (its ObjectMapper may reject it)`;
}

export const RUNTIME_VERSION = '9.0.0';
