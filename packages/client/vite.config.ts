import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Самоподписанный сертификат: без HTTPS браузер не даст камеру и микрофон при доступе по LAN.
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin: клиент подключается через io() без URL, Vite проксирует на Node.
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
