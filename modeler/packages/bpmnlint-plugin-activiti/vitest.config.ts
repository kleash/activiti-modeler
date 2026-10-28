import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // editor tests need a DOM (they declare `// @vitest-environment jsdom`) and the SVG stand-ins of bpmn-js-activiti
    setupFiles: ['./test-support/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
