import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { docsDir, generateAll, outDir, readSpecs } from '../scripts/generate.mjs';
import { OPERATION_METHODS, RuntimeClient, operations } from './index';

interface Spec {
  name: string;
  spec: { paths: Record<string, Record<string, { operationId?: string }>>; components?: { schemas?: Record<string, unknown> } };
}

const specs = readSpecs(docsDir) as Spec[];
const HTTP = ['get', 'put', 'post', 'delete', 'patch'];

describe('generated files', () => {
  it('are up to date with docs/api/openapi-*.json (run `npm run generate` otherwise)', () => {
    const files = generateAll(docsDir) as Record<string, string>;
    for (const [name, content] of Object.entries(files)) {
      expect(readFileSync(join(outDir, name), 'utf8'), `src/generated/${name}`).toBe(content);
    }
  });

  it('are made from the three published descriptions', () => {
    expect(specs.map((s) => s.name)).toEqual(['openapi-core.json', 'openapi-dev.json', 'openapi-server.json']);
  });
});

describe('the client against the OpenAPI descriptions', () => {
  const described = new Map<string, { method: string; path: string }>();
  for (const { spec } of specs) {
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (HTTP.includes(method) && operation.operationId) {
          described.set(operation.operationId, { method: method.toUpperCase(), path });
        }
      }
    }
  }

  it('knows every operation the API describes, with the same method and path', () => {
    expect([...described.keys()].sort()).toEqual(Object.keys(operations).sort());
    for (const [id, { method, path }] of described) {
      const known = operations[id as keyof typeof operations];
      expect(`${known.method} /api${known.path}`, id).toBe(`${method} ${path}`);
    }
  });

  it('has a method for every operation', () => {
    const client = new RuntimeClient();
    for (const id of described.keys()) {
      const method = OPERATION_METHODS[id as keyof typeof OPERATION_METHODS];
      expect(method, `no client method named for ${id}`).toBeTruthy();
      expect(typeof (client as unknown as Record<string, unknown>)[method], `RuntimeClient.${method}`).toBe('function');
    }
  });

  it('has a path parameter for every placeholder, and the operations that send a body say so', () => {
    for (const [id, spec] of Object.entries(operations)) {
      const placeholders = [...spec.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      expect([...spec.pathParams], id).toEqual(placeholders);
    }
    expect(operations.startProcessInstance.hasBody).toBe(true);
    expect(operations.getEngine.hasBody).toBe(false);
  });

  it('describes the problem model the client maps: schemas for every request and response type it uses', () => {
    const schemas = new Set(specs.flatMap((s) => Object.keys(s.spec.components?.schemas ?? {})));
    for (const name of ['StartRequest', 'InstanceDetail', 'Task', 'Job', 'EngineInfo', 'ValidateResponse', 'ScenarioRunResponse', 'WorkspaceListing', 'Mailbox', 'Health']) {
      expect(schemas.has(name), name).toBe(true);
    }
  });
});
