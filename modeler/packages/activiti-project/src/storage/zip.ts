import { strToU8, unzipSync, zipSync } from 'fflate';

import { normalizeConnectorFiles } from '../connectors';
import { isProjectTextFile } from '../project/kinds';
import type { ProjectFileData } from '../project/model';
import { pathProblem } from '../project/paths';

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
export const MAX_ZIP_FILES = 5000;
export const MAX_ZIP_BYTES = 64 * 1024 * 1024;

/**
 * Zips the project in the ADR 0003 layout: the files sit at the root of the archive, so the zip can be unpacked into
 * `src/main/resources/` of a Spring Boot app. Entries are sorted and carry one fixed timestamp, so the same project always
 * gives the same bytes.
 */
export function exportZip(files: readonly ProjectFileData[], modified: Date = new Date(2000, 0, 1)): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {};
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const problem = pathProblem(file.path);
    if (problem) throw new Error(`Cannot zip "${file.path}": ${problem}`);
    entries[file.path] = [strToU8(file.content), { mtime: modified, level: 6 }];
  }
  return zipSync(entries);
}

export interface ZipImport {
  files: ProjectFileData[];
  /** Things that were skipped or changed on the way in. */
  warnings: string[];
  /** The wrapper folder that was removed (zips made by "compress folder" have one). */
  strippedFolder?: string;
}

const HIDDEN_OR_NOISE = (segments: string[]): boolean => segments.some((s) => (s.startsWith('.') && s !== '.' && s !== '..') || s === '__MACOSX' || s === 'Thumbs.db' || s === 'desktop.ini');

/**
 * Reads a project zip. Never throws for content problems it can skip (binary files, hidden files, bad names): they come back as
 * warnings. Throws when the data is not a zip or exceeds the limits.
 */
export function importZip(data: Uint8Array): ZipImport {
  let total = 0;
  let count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(data, {
      filter(file) {
        if (file.name.endsWith('/')) return false;
        count += 1;
        total += file.originalSize;
        if (count > MAX_ZIP_FILES) throw new Error(`The zip has more than ${MAX_ZIP_FILES} files`);
        if (total > MAX_ZIP_BYTES) throw new Error(`The zip expands to more than ${MAX_ZIP_BYTES / 1024 / 1024} MB`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof Error && /files|MB/.test(e.message) && e.message.startsWith('The zip')) throw e;
    throw new Error(`Not a readable zip file: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }

  const warnings: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let entries: Array<{ path: string; bytes: Uint8Array }> = [];
  let skippedNoise = 0;
  let skippedBinary = 0;
  for (const [rawName, bytes] of Object.entries(raw)) {
    const name = rawName.replace(/\\/g, '/');
    const segments = name.split('/');
    if (HIDDEN_OR_NOISE(segments)) {
      skippedNoise += 1;
      continue;
    }
    entries.push({ path: name, bytes });
  }

  // a wrapper folder around the project (zip made by "compress folder"): drop it
  let strippedFolder: string | undefined;
  const firstSegments = new Set(entries.map((e) => e.path.split('/')[0]));
  if (entries.length > 0 && firstSegments.size === 1 && entries.every((e) => e.path.includes('/'))) {
    strippedFolder = [...firstSegments][0];
    entries = entries.map((e) => ({ ...e, path: e.path.slice(strippedFolder!.length + 1) }));
  }

  const files: ProjectFileData[] = [];
  for (const { path, bytes } of entries) {
    const problem = pathProblem(path);
    if (problem) {
      warnings.push(`Skipped "${path}": ${problem}`);
      continue;
    }
    if (!isProjectTextFile(path)) {
      skippedBinary += 1;
      continue;
    }
    try {
      files.push({ path, content: decoder.decode(bytes).replace(BOM, '') });
    } catch {
      warnings.push(`Skipped "${path}": it is not valid UTF-8 text`);
    }
  }
  if (skippedNoise > 0) warnings.push(`Ignored ${skippedNoise} hidden or system file(s)`);
  if (skippedBinary > 0) warnings.push(`Ignored ${skippedBinary} file(s) that are not text (only text files are part of a project)`);
  if (strippedFolder) warnings.push(`Removed the folder "${strippedFolder}" that wrapped the project`);
  // connector files hold only what the runtime reads (ADR 0003): the rest of a descriptor moves to project.json
  const normalized = normalizeConnectorFiles(files);
  warnings.push(...normalized.warnings);
  normalized.files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files: normalized.files, warnings, ...(strippedFolder ? { strippedFolder } : {}) };
}

/** Project name for an imported zip: `project.json`'s name, else the file name without `.zip`. */
export function projectNameFromZip(files: readonly ProjectFileData[], zipFileName: string): string {
  const descriptor = files.find((f) => f.path === 'project.json');
  if (descriptor) {
    try {
      const name = (JSON.parse(descriptor.content) as { name?: unknown }).name;
      if (typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(name)) return name;
    } catch {
      // fall through to the file name
    }
  }
  const base = zipFileName.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').replace(/[. ]+$/, '').slice(0, 64);
  return base || 'imported-project';
}
