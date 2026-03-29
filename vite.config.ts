import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react({
      // Only apply React transform to henryjeff files
      include: '**/henryjeff/**/*.{tsx,jsx}',
    }),
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
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        test: resolve(__dirname, 'test/index.html'),
        henryjeff: resolve(__dirname, 'henryjeff/index.html'),
      },
    },
  },
  esbuild: {
    target: 'esnext' // Ensure esbuild uses modern JS features
  },
  server: {
    port: 3000,
    open: true
  }
})