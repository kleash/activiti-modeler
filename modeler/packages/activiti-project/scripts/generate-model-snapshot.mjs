#!/usr/bin/env node
/**
 * Generates support/activiti-model-fields.json: the JSON properties of the Activiti 9.0.0 classes that the runtime reads
 * `<name>-extensions.json` into (org.activiti.spring.process.model.* of activiti-spring-process-extensions, plus
 * org.activiti.core.common.model.connector.VariableDefinition of activiti-connector-model, which VariableDefinition extends).
 *
 *   node scripts/generate-model-snapshot.mjs --sources <dir> [--check]
 *   node scripts/generate-model-snapshot.mjs --process-extensions <dir|jar> --connector-model <dir|jar> [--check]
 *
 * `--sources` is a folder that holds the two unpacked source jars as `activiti-spring-process-extensions/` and
 * `activiti-connector-model/`. A property is a JavaBean setter (what Jackson deserialises through), with the name of an
 * `@JsonProperty("...")` field substituted where the class declares one. runtime-model.test.ts compares src/runtime-model.ts
 * with this snapshot on every run, so the list of written fields cannot drift from the Java classes without a failing test;
 * `--check` (or ACTIVITI_MODEL_SOURCES in that test) proves the snapshot itself against the sources.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = resolve(HERE, '../support/activiti-model-fields.json');

const MODEL_PACKAGE = 'org.activiti.spring.process.model';
const CONNECTOR_CLASS = 'org.activiti.core.common.model.connector.VariableDefinition';

function asDirectory(path) {
  if (!path.endsWith('.jar')) return path;
  const dir = mkdtempSync(join(tmpdir(), 'activiti-model-sources-'));
  execFileSync('unzip', ['-q', '-o', path, '-d', dir]);
  return dir;
}

function parseClass(source) {
  const setters = new Set();
  for (const match of source.matchAll(/public\s+void\s+set([A-Z]\w*)\s*\(\s*[\w<>, ?.]+\s+\w+\s*\)/g)) {
    setters.add(match[1][0].toLowerCase() + match[1].slice(1));
  }
  const renames = {};
  for (const match of source.matchAll(/@JsonProperty\("(\w+)"\)\s*private\s+[\w<>, ?.]+\s+(\w+)\s*;/g)) renames[match[2]] = match[1];
  const properties = [...setters].map((name) => renames[name] ?? name).sort();
  const parent = /class\s+\w+\s+extends\s+([\w.]+)/.exec(source)?.[1];
  return { properties, ...(parent ? { extends: parent } : {}) };
}

/** The snapshot object for the two source folders. */
export function extractModelFields({ processExtensions, connectorModel }) {
  const modelDir = join(asDirectory(processExtensions), ...MODEL_PACKAGE.split('.'));
  const connectorFile = join(asDirectory(connectorModel), ...CONNECTOR_CLASS.split('.')) + '.java';
  if (!existsSync(modelDir)) throw new Error(`${modelDir} does not exist; is --process-extensions the unpacked activiti-spring-process-extensions sources?`);
  if (!existsSync(connectorFile)) throw new Error(`${connectorFile} does not exist; is --connector-model the unpacked activiti-connector-model sources?`);
  const classes = {};
  for (const file of readdirSync(modelDir).filter((f) => f.endsWith('.java')).sort()) {
    const fqcn = `${MODEL_PACKAGE}.${file.replace(/\.java$/, '')}`;
    classes[fqcn] = parseClass(readFileSync(join(modelDir, file), 'utf8'));
  }
  classes[CONNECTOR_CLASS] = parseClass(readFileSync(connectorFile, 'utf8'));
  // a parent named without a package is a class of the model package, or a JDK class (ProcessConstantsMapping extends HashMap)
  for (const entry of Object.values(classes)) {
    if (entry.extends && !entry.extends.includes('.') && classes[`${MODEL_PACKAGE}.${entry.extends}`]) entry.extends = `${MODEL_PACKAGE}.${entry.extends}`;
  }
  return {
    source: 'org.activiti:activiti-spring-process-extensions:9.0.0 and org.activiti:activiti-connector-model:9.0.0 (JavaBean setters)',
    classes: Object.fromEntries(Object.entries(classes).sort(([a], [b]) => a.localeCompare(b))),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const root = value('--sources') ?? process.env.ACTIVITI_MODEL_SOURCES;
  const processExtensions = value('--process-extensions') ?? (root && join(root, 'activiti-spring-process-extensions'));
  const connectorModel = value('--connector-model') ?? (root && join(root, 'activiti-connector-model'));
  if (!processExtensions || !connectorModel || (root && !statSync(root, { throwIfNoEntry: false }))) {
    console.error('usage: generate-model-snapshot.mjs --sources <dir> | --process-extensions <dir|jar> --connector-model <dir|jar> [--check]');
    process.exit(2);
  }
  const text = `${JSON.stringify(extractModelFields({ processExtensions, connectorModel }), null, 2)}\n`;
  if (args.includes('--check')) {
    if (!existsSync(SNAPSHOT_PATH) || readFileSync(SNAPSHOT_PATH, 'utf8') !== text) {
      console.error('support/activiti-model-fields.json is stale; run node scripts/generate-model-snapshot.mjs');
      process.exit(1);
    }
    console.log('model field snapshot up to date');
  } else {
    writeFileSync(SNAPSHOT_PATH, text);
    console.log(`wrote ${SNAPSHOT_PATH}`);
  }
}
