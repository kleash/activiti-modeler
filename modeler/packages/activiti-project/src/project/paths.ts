/** Project-relative paths: `/` separated, no leading slash, no `.` or `..` segments (ADR 0003). */

export const MAX_PATH_LENGTH = 240;

/** Why `path` is not a valid project path; undefined when it is. */
export function pathProblem(path: string): string | undefined {
  if (path.length === 0) return 'The path is empty';
  if (path.length > MAX_PATH_LENGTH) return `The path is longer than ${MAX_PATH_LENGTH} characters`;
  if (path.startsWith('/')) return 'The path must be relative (no leading "/")';
  if (path.endsWith('/')) return 'The path must name a file, not a folder';
  if (path.includes('\\')) return 'Use "/" as the path separator';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f<>:"|?*]/.test(path)) return 'The path contains a character that is not allowed in file names (< > : " | ? * or a control character)';
  for (const segment of path.split('/')) {
    if (segment === '') return 'The path contains an empty folder name ("//")';
    if (segment === '.' || segment === '..') return 'The path must not contain "." or ".." segments';
    if (segment.endsWith(' ') || segment.endsWith('.')) return `"${segment}" must not end with a space or a dot`;
  }
  return undefined;
}

export function isValidPath(path: string): boolean {
  return pathProblem(path) === undefined;
}

/** Throws when `path` is not a valid project path. */
export function assertValidPath(path: string): string {
  const problem = pathProblem(path);
  if (problem) throw new Error(`Invalid project path "${path}": ${problem}`);
  return path;
}

export const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Folder of a path without trailing slash; empty for a file in the project root. */
export const dirname = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

export const joinPath = (...parts: string[]): string => parts.filter((p) => p !== '').join('/');

/** Compares paths so that folders sort before files at the same level, otherwise alphabetically (case-insensitive). */
export function comparePaths(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  for (let i = 0; i < Math.min(as.length, bs.length); i += 1) {
    if (as[i] === bs[i]) continue;
    const aIsFolder = i < as.length - 1;
    const bIsFolder = i < bs.length - 1;
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return as[i]!.localeCompare(bs[i]!, 'en', { sensitivity: 'base', numeric: true }) || (as[i]! < bs[i]! ? -1 : 1);
  }
  return as.length - bs.length;
}

export interface TreeNode {
  /** Folder or file name. */
  name: string;
  /** Project path of the file, or of the folder (without trailing slash). */
  path: string;
  type: 'folder' | 'file';
  children: TreeNode[];
}

/** The explorer tree of a set of file paths: folders first, then files, each alphabetically. */
export function buildTree(paths: Iterable<string>): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'folder', children: [] };
  for (const path of [...paths].sort(comparePaths)) {
    const segments = path.split('/');
    let node = root;
    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      const childPath = segments.slice(0, index + 1).join('/');
      let child = node.children.find((c) => c.name === segment && c.type === (isFile ? 'file' : 'folder'));
      if (!child) {
        child = { name: segment, path: childPath, type: isFile ? 'file' : 'folder', children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  return root.children;
}

const MULTI_PART_SUFFIXES = ['-extensions.json', '.bpmn20.xml', '.scenario.json'];

/** Splits a file name into stem and suffix, keeping multi part suffixes (`.bpmn20.xml`, `-extensions.json`) whole. */
export function splitName(name: string): { stem: string; suffix: string } {
  for (const suffix of MULTI_PART_SUFFIXES) if (name.endsWith(suffix) && name.length > suffix.length) return { stem: name.slice(0, -suffix.length), suffix };
  const dot = name.lastIndexOf('.');
  return dot > 0 ? { stem: name.slice(0, dot), suffix: name.slice(dot) } : { stem: name, suffix: '' };
}

/** `a/name.ext` -> `a/name-2.ext`, `a/name-3.ext`, ... until `taken` no longer reports the candidate. */
export function uniquePath(path: string, taken: (candidate: string) => boolean): string {
  if (!taken(path)) return path;
  const { stem, suffix } = splitName(basename(path));
  const folder = dirname(path);
  for (let n = 2; ; n += 1) {
    const candidate = joinPath(folder, `${stem}-${n}${suffix}`);
    if (!taken(candidate)) return candidate;
  }
}
