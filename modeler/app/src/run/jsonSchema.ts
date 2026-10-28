/**
 * A small JSON Schema (2020-12) validator for the keywords `schemas/scenario.schema.json` uses, so that the scenario editor can
 * check a file against the same schema the server's runner validates with, without a library (no dependency may be added).
 *
 * Supported: `$ref` (local `#/...`), `type`, `enum`, `const`, `required`, `properties`, `additionalProperties`, `propertyNames`
 * (`pattern`), `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `pattern`, `minimum`, `minProperties`,
 * `maxProperties`, `allOf`, `anyOf`, `oneOf`, `if` / `then` / `else`, and boolean schemas. Other keywords (annotations such as
 * `description`, `default`) are ignored.
 */

export interface SchemaProblem {
  /** JSON pointer of the value, `/scenarios/0/start`. */
  pointer: string;
  message: string;
  /** The problem is about a property name (an unknown property) rather than its value. */
  key?: string;
}

type Schema = boolean | { [keyword: string]: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class SchemaValidator {
  constructor(private readonly root: Record<string, unknown>) {}

  /** All problems of `value`; empty when it conforms. */
  validate(value: unknown): SchemaProblem[] {
    const problems: SchemaProblem[] = [];
    this.check(this.root, value, '', problems);
    return problems;
  }

  private resolve(ref: string): Schema {
    if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
    let node: unknown = this.root;
    for (const part of ref.slice(2).split('/')) {
      node = (node as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return node as Schema;
  }

  /** True when `value` conforms to `schema` (no messages). */
  private ok(schema: Schema, value: unknown): boolean {
    const probe: SchemaProblem[] = [];
    this.check(schema, value, '', probe);
    return probe.length === 0;
  }

  private check(schema: Schema, value: unknown, pointer: string, out: SchemaProblem[]): void {
    if (schema === true) return;
    if (schema === false) {
      out.push({ pointer, message: 'is not allowed here' });
      return;
    }
    if (typeof schema['$ref'] === 'string') this.check(this.resolve(schema['$ref']), value, pointer, out);
    const here = (message: string): void => void out.push({ pointer, message });

    const type = schema['type'];
    if (type !== undefined) {
      const types = Array.isArray(type) ? (type as string[]) : [type as string];
      if (!types.some((t) => matchesType(value, t))) {
        here(`must be ${types.length === 1 ? `a ${types[0]}` : `one of ${types.join(', ')}`} (found ${typeOf(value)})`);
        return;
      }
    }
    if (Array.isArray(schema['enum']) && !schema['enum'].some((e) => deepEqual(e, value))) here(`must be one of ${(schema['enum'] as unknown[]).map((e) => JSON.stringify(e)).join(', ')}`);
    if ('const' in schema && !deepEqual(schema['const'], value)) here(`must be ${JSON.stringify(schema['const'])}`);

    if (typeof value === 'string') {
      if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) here(`must not be shorter than ${schema['minLength']} character(s)`);
      if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern']).test(value)) here(`does not match the pattern ${schema['pattern']}`);
    }
    if (typeof value === 'number' && typeof schema['minimum'] === 'number' && value < schema['minimum']) here(`must be at least ${schema['minimum']}`);

    if (Array.isArray(value)) {
      if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) here(`needs at least ${schema['minItems']} item(s)`);
      if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) here(`takes at most ${schema['maxItems']} item(s)`);
      if (schema['uniqueItems'] === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) here('must not repeat an item');
      const prefix = Array.isArray(schema['prefixItems']) ? (schema['prefixItems'] as Schema[]) : [];
      value.forEach((item, i) => {
        const itemSchema = i < prefix.length ? prefix[i] : (schema['items'] as Schema | undefined);
        if (itemSchema !== undefined) this.check(itemSchema, item, `${pointer}/${i}`, out);
      });
    }

    if (isObject(value)) {
      const keys = Object.keys(value);
      if (typeof schema['minProperties'] === 'number' && keys.length < schema['minProperties']) here(`needs at least ${schema['minProperties']} propert${schema['minProperties'] === 1 ? 'y' : 'ies'}`);
      if (typeof schema['maxProperties'] === 'number' && keys.length > schema['maxProperties']) here(`takes at most ${schema['maxProperties']} propert${schema['maxProperties'] === 1 ? 'y' : 'ies'} (found ${keys.join(', ')})`);
      for (const name of (schema['required'] as string[] | undefined) ?? []) {
        if (!(name in value)) here(`needs the property "${name}"`);
      }
      const properties = (isObject(schema['properties']) ? schema['properties'] : {}) as Record<string, Schema>;
      for (const [name, sub] of Object.entries(properties)) {
        if (name in value) this.check(sub, value[name], `${pointer}/${name}`, out);
      }
      if (isObject(schema['propertyNames']) && typeof schema['propertyNames']['pattern'] === 'string') {
        const pattern = new RegExp(schema['propertyNames']['pattern']);
        for (const name of keys) if (!pattern.test(name)) out.push({ pointer: `${pointer}/${name}`, key: name, message: `the name "${name}" is not valid (pattern ${pattern.source})` });
      }
      const additional = schema['additionalProperties'];
      for (const name of keys) {
        if (name in properties) continue;
        if (additional === false) out.push({ pointer: `${pointer}/${name}`, key: name, message: `"${name}" is not a known property here` });
        else if (additional !== undefined && additional !== true) this.check(additional as Schema, value[name], `${pointer}/${name}`, out);
      }
    }

    for (const sub of (schema['allOf'] as Schema[] | undefined) ?? []) this.check(sub, value, pointer, out);
    if (Array.isArray(schema['anyOf'])) {
      const alternatives = schema['anyOf'] as Schema[];
      if (!alternatives.some((s) => this.ok(s, value))) {
        // the alternatives are usually "needs process / message / signal / timer": say what is missing
        const needs = alternatives.flatMap((s) => (isObject(s) && Array.isArray(s['required']) ? [(s['required'] as string[]).join(' + ')] : []));
        here(needs.length > 0 ? `needs one of: ${needs.join(', ')}` : 'does not match any alternative');
      }
    }
    if (Array.isArray(schema['oneOf'])) {
      const alternatives = schema['oneOf'] as Schema[];
      const matching = alternatives.filter((s) => this.ok(s, value)).length;
      if (matching !== 1) {
        // report the problems of the alternative that fits best (the fewest problems), which is the one the author meant
        const attempts = alternatives.map((s) => {
          const found: SchemaProblem[] = [];
          this.check(s, value, pointer, found);
          return found;
        });
        const best = attempts.reduce((a, b) => (b.length < a.length ? b : a), attempts[0] ?? []);
        if (matching === 0 && best.length > 0) out.push(...best);
        else here(matching === 0 ? 'does not match any alternative' : 'matches more than one alternative');
      }
    }
    if ('if' in schema) {
      if (this.ok(schema['if'] as Schema, value)) {
        if ('then' in schema) this.check(schema['then'] as Schema, value, pointer, out);
      } else if ('else' in schema) {
        this.check(schema['else'] as Schema, value, pointer, out);
      }
    }
  }
}
