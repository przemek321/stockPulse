import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    // Vite 5+: DNS rebinding protection — whitelist Tailscale MagicDNS
    // (*.ts.net to prywatna sieć z własną autoryzacją) oraz localhost.
    allowedHosts: ['.ts.net', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        // W Docker: backend = serwis "app"; lokalnie: localhost
        target: process.env.API_URL || 'http://app:3000',
        changeOrigin: true,
      },
    },
  },
});
