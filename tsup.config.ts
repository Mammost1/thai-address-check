import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  // @geothai/core stays a runtime dependency: its data is never bundled into this package.
  external: ['@geothai/core'],
})
