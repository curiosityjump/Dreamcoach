import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  root: '.',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./client', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.DC_API ?? 'http://localhost:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
