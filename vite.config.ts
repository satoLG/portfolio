import { defineConfig } from 'vite'
import glsl from 'vite-plugin-glsl'
import { resolve } from 'path'

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
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          'three': ['three'],
          'wavesurfer': ['wavesurfer.js'],
          'vendor': ['lil-gui', 'bezier-easing'],
        },
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