import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rootDir = path.resolve(import.meta.dirname);

export default defineConfig({
  root: rootDir,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(rootDir, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    lib: { entry: 'src/main.tsx', formats: ['iife'], name: 'AaniSmoke', fileName: () => 'app.iife.js' },
    outDir: '/tmp/smoke/dist',
    emptyOutDir: true,
    cssCodeSplit: false,
  },
  define: { 'process.env.NODE_ENV': '"production"' },
});
