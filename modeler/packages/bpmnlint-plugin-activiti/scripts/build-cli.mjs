// Bundles src/cli.ts (and the workspace packages it uses) into dist/activiti-lint.mjs for Node. The npm packages
// (bpmnlint, bpmn-moddle, ...) stay external and are loaded from node_modules.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildCli(outDir = resolve(root, 'dist')) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    ssr: { noExternal: [/^@activiti-modeler\//] },
    build: {
      ssr: resolve(root, 'src/cli.ts'),
      outDir,
      emptyOutDir: true,
      target: 'node22',
      minify: false,
      rollupOptions: { output: { format: 'es', entryFileNames: 'activiti-lint.mjs' } },
    },
  });
  return resolve(outDir, 'activiti-lint.mjs');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`built ${await buildCli()}`);
}
