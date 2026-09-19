import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: false })],
  worker: { format: 'es' },
  optimizeDeps: { include: ['fflate'] },
  server: { host: '127.0.0.1' },
});
