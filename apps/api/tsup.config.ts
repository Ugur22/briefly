import { defineConfig } from 'tsup';

export default defineConfig({
  // The extraction worker is its own file: extract-text.ts starts it as dist/extract-worker.js.
  entry: { main: 'src/main.ts', 'extract-worker': 'src/briefs/infra/extract-worker.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // One self-contained file, so the runtime image needs no node_modules (and no Bun).
  noExternal: [/.*/],
  // Bundled CommonJS deps call require(); ESM output has none unless we create it.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
