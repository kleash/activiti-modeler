// Runs the corpus builds: `npm run corpus:build -- [<id-prefix>[,<id-prefix>...]] [playwright options]`.
// Without an id every corpus/<id>/build.ts runs. The projects are written to java/verification-harness/target/corpus/<id>
// (override with CORPUS_OUT=<dir>), where the verification harness finds them; the builds that also run through the real UI write
// to target/corpus-ui/<id> (<CORPUS_OUT>-ui). --grep='\[ui\]' runs only those, --grep-invert='\[ui\]' leaves them out.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('-')).flatMap((a) => a.split(','));
const options = args.filter((a) => a.startsWith('-'));

const result = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.corpus.config.ts', ...options], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CORPUS_PROJECTS: ids.join(',') },
});
process.exit(result.status ?? 1);
