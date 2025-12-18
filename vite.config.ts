import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'

export default defineConfig({
  plugins: [
    glsl({
      include: [
        '**/*.glsl',
        '**/*.wgsl',
        '**/*.vert',
        '**/*.frag'
      ],
      exclude: undefined,
      warnDuplicatedImports: true,
      defaultExtension: 'glsl',
      watch: true
    })
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext'
    }
  },
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'esnext', // Support modern JS features including top-level await
    minify: 'esbuild',
    sourcemap: true
  },
  esbuild: {
    target: 'esnext' // Ensure esbuild uses modern JS features
  },
  server: {
    port: 3000,
    open: true
  }
})