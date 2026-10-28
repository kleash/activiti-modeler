/**
 * `activiti-lint <path>...`: lints modeler projects with the same rules the modeler runs, for CI and the corpus checks. A path is a
 * project folder, a single file (linted as a project of its own, with the `<name>-extensions.json` next to a process), or, with
 * `--seeds`, a corpus folder whose `<id>/seed` projects are linted. Exit status 1 when a project has an error (or, with
 * `--max-warnings n`, more than n warnings), 2 for a wrong command line or a path that does not exist.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ProjectFile } from '@activiti-modeler/activiti-project';

import { RULES } from './catalog';
import { countProblems, lintProject, type LintProjectOptions } from './project';
import type { Problem } from './types';

interface Options {
  targets: string[];
  seeds: boolean;
  json: boolean;
  quiet: boolean;
  maxWarnings?: number;
  only?: string[];
  ignore: string[];
  list: boolean;
  lint: LintProjectOptions;
}

const USAGE = `Usage: activiti-lint <project-dir | file>... [options]

  A file (a process, a DMN or a JSON file) is linted as a project of its own; a process brings the
  <name>-extensions.json next to it.

  --seeds              treat each argument as a corpus folder and lint <id>/seed of every project in it
  --json               print the result as JSON
  --quiet              print errors only
  --max-warnings <n>   fail when there are more than n warnings
  --ignore <rule>      ignore a rule (activiti/<id> or bpmnlint/<name>); repeatable
  --kie                lint DMN for the KIE engine (allow boxed expressions and BKMs)
  --async-off          the engine runs without an async executor
  --script-engine <n>  a JSR-223 script engine the application provides (repeatable)
  --list-rules         print the rules and exit
  -h, --help           this text
`;

export function parseArgs(argv: string[]): Options {
  const options: Options = { targets: [], seeds: false, json: false, quiet: false, ignore: [], list: false, lint: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const value = (): string => {
      const next = argv[(i += 1)];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === '--seeds') options.seeds = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--max-warnings') options.maxWarnings = Number(value());
    else if (arg === '--ignore') options.ignore.push(value());
    else if (arg === '--kie') options.lint.dmnProfile = 'kie';
    else if (arg === '--async-off') options.lint.asyncExecutorActive = false;
    else if (arg === '--script-engine') options.lint.scriptEngines = [...(options.lint.scriptEngines ?? []), value()];
    else if (arg === '--list-rules') options.list = true;
    else if (arg === '-h' || arg === '--help') throw new Error('help');
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else options.targets.push(arg);
  }
  return options;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'scenarios']);

/** Text files of a project folder, with project-relative paths. */
export function readProjectFiles(root: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(bpmn20\.xml|bpmn|dmn|json)$/.test(name)) files.push({ path: relative(root, full).split(sep).join('/'), content: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  return files;
}

/** A single file as a project of its own: the file, and the extensions sidecar next to a process. */
export function readSingleFile(file: string): ProjectFile[] {
  const name = basename(file);
  const files: ProjectFile[] = [{ path: name, content: readFileSync(file, 'utf8') }];
  const sidecar = name.replace(/\.(bpmn20\.xml|bpmn)$/, '-extensions.json');
  if (sidecar !== name && existsSync(join(dirname(file), sidecar))) files.push({ path: sidecar, content: readFileSync(join(dirname(file), sidecar), 'utf8') });
  return files;
}

/** The project folders to lint for a target. */
export function projectFolders(target: string, seeds: boolean): string[] {
  const root = resolve(target);
  if (!seeds) return [root];
  return readdirSync(root)
    .sort()
    .map((name) => join(root, name, 'seed'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

/** A problem without its internal id. */
const omitId = (problem: Problem): Omit<Problem, 'id'> => {
  const { id, ...rest } = problem;
  void id;
  return rest;
};

const format = (p: Problem): string => `  ${p.path}${p.elementId ? ` [${p.elementId}]` : ''}  ${p.severity.padEnd(7)} ${p.rule}  ${p.message}`;

export async function run(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    out(message === 'help' ? USAGE : `${message}\n\n${USAGE}`);
    return message === 'help' ? 0 : 2;
  }
  if (options.list) {
    for (const rule of RULES) out(`${rule.severity.padEnd(5)} activiti/${rule.id}${rule.key ? `  (${rule.key})` : ''}  ${rule.title}`);
    return 0;
  }
  if (options.targets.length === 0) {
    out(USAGE);
    return 2;
  }
  for (const target of options.targets) {
    if (!existsSync(target)) {
      out(`${target}: no such file or directory\n\n${USAGE}`);
      return 2;
    }
    if (options.seeds && !statSync(target).isDirectory()) {
      out(`${target}: --seeds needs a corpus folder, not a file\n\n${USAGE}`);
      return 2;
    }
  }
  const ignored = new Set(options.ignore);
  let errors = 0;
  let warnings = 0;
  const report: Array<{ project: string; problems: Problem[] }> = [];
  for (const target of options.targets) {
    for (const folder of projectFolders(target, options.seeds)) {
      const files = statSync(folder).isFile() ? readSingleFile(folder) : readProjectFiles(folder);
      const result = await lintProject(files, options.lint);
      const problems = result.problems.filter((p) => !ignored.has(p.rule));
      const counts = countProblems(problems);
      errors += counts.error;
      warnings += counts.warning;
      report.push({ project: folder, problems });
      if (!options.json) {
        const shown = options.quiet ? problems.filter((p) => p.severity === 'error') : problems;
        out(`${folder}: ${files.filter((f) => /bpmn|dmn/.test(f.path)).length} model file(s), ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} note(s)`);
        for (const p of shown) out(format(p));
      }
    }
  }
  if (options.json) out(JSON.stringify(report.map((r) => ({ project: r.project, problems: r.problems.map((p) => omitId(p)) })), null, 2));
  else out(`\n${errors} error(s), ${warnings} warning(s) in ${report.length} project(s)`);
  if (errors > 0) return 1;
  if (options.maxWarnings !== undefined && warnings > options.maxWarnings) return 1;
  return 0;
}

// executed when started as a program (not when imported by the tests)
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // `exitCode`, not `exit()`: the output is complete when stdout is a pipe
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 2;
    },
  );
}
