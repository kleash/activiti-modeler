import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { locatePointers, rangeFor } from './jsonPointers';
import { SchemaValidator } from './jsonSchema';
import { checkScenarioText, STEP_TYPES } from './scenarioSchema';

const REPO = join(__dirname, '../../../../');

describe('SchemaValidator', () => {
  const v = new SchemaValidator({
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: { name: { type: 'string', minLength: 1 }, n: { type: 'integer', minimum: 1 }, tags: { type: 'array', items: { type: 'string' }, uniqueItems: true }, kind: { enum: ['a', 'b'] }, p: { $ref: '#/$defs/p' } },
    $defs: { p: { type: 'string', pattern: '^x' } },
    anyOf: [{ required: ['n'] }, { required: ['tags'] }],
  });

  it('accepts a conforming value', () => expect(v.validate({ name: 'a', n: 2 })).toEqual([]));

  it('reports what is wrong, with pointers', () => {
    const problems = v.validate({ name: '', n: 0, tags: ['a', 'a'], kind: 'c', p: 'y', extra: 1 });
    expect(problems.map((p) => `${p.pointer}: ${p.message}`)).toEqual(
      expect.arrayContaining([
        '/name: must not be shorter than 1 character(s)',
        '/n: must be at least 1',
        '/tags: must not repeat an item',
        '/kind: must be one of "a", "b"',
        '/p: does not match the pattern ^x',
        '/extra: "extra" is not a known property here',
      ]),
    );
  });

  it('says which alternative is missing', () => expect(v.validate({ name: 'a' }).map((p) => p.message)).toEqual(['needs one of: n, tags']));
  it('checks types', () => expect(v.validate({ name: 3 }).map((p) => p.message)[0]).toBe('must be a string (found integer)'));
});

describe('checkScenarioText', () => {
  it('accepts a minimal scenario file', () => {
    expect(checkScenarioText(JSON.stringify({ name: 'file', scenarios: [{ name: 's', start: { process: 'p' }, steps: [{ executeJobs: {} }], expect: { state: 'COMPLETED' } }] })).diagnostics).toEqual([]);
  });

  it('marks the offending value in the text', () => {
    const text = `{\n  "name": "f",\n  "scenarios": [\n    { "name": "s", "start": { "process": "p" }, "steps": [ { "completeTask": { "activity": "a" } } ] }\n  ]\n}`;
    const { diagnostics } = checkScenarioText(text);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.message).toContain('/scenarios/0/steps/0/completeTask: needs the property "user"');
    expect(text.slice(diagnostics[0]!.from, diagnostics[0]!.to)).toContain('activity');
  });

  it('reports a syntax error', () => {
    const { diagnostics } = checkScenarioText('{"scenarios": [');
    expect(diagnostics[0]!.message).toMatch(/^Invalid JSON/);
  });

  it('knows the step types of the schema', () => {
    expect(STEP_TYPES).toEqual(expect.arrayContaining(['completeTask', 'message', 'signal', 'fireTimer', 'executeJobs', 'expectActive', 'setVariables']));
  });

  it('accepts every hand-written scenario file of the corpus (the schema and the validator agree with the runner)', () => {
    const corpus = join(REPO, 'corpus');
    let count = 0;
    for (const id of readdirSync(corpus)) {
      const dir = join(corpus, id, 'scenarios');
      let files: string[];
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.scenario.json'));
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(join(dir, file), 'utf8');
        expect(checkScenarioText(text).diagnostics, `${id}/${file}`).toEqual([]);
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(50);
  });
});

describe('locatePointers', () => {
  it('finds values and keys', () => {
    const text = '{"a": [1, {"b": true}], "c/d": "x"}';
    const map = locatePointers(text);
    expect(text.slice(map.values.get('/a/1/b')!.from, map.values.get('/a/1/b')!.to)).toBe('true');
    expect(text.slice(map.keys.get('/c~1d')!.from, map.keys.get('/c~1d')!.to)).toBe('"c/d"');
    expect(rangeFor(map, '/a/5/zzz')).toEqual(map.values.get('/a')!);
  });
});
