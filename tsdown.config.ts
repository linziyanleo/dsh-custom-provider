import { defineConfig } from 'tsdown'

/**
 * Build the browser half into the host's lazy-CJS module format: one classic
 * script that registers its factory with `window.__ModuleLoader__`, with every
 * host-provided import (react, @deepseek-ai/*) externalized to the loader's
 * synchronous `require`.
 */
export default defineConfig({
  entry: { client: 'client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  target: 'es2022',
  tsconfig: 'tsconfig.client.json',
  deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom', /^@deepseek-ai\//] },
  outExtensions: () => ({ js: '.js' }),
  clean: false,
  sourcemap: true,
  dts: true,
  outputOptions: {
    banner: [
      'window.__ModuleLoader__.load({',
      '\tid: "@linziyanleo/dsh-custom-provider",',
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
    ].join('\n'),
    footer: [
      '\t\treturn module.exports;',
      '\t}',
      '});',
    ].join('\n'),
  },
})
