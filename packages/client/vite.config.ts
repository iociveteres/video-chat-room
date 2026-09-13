import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// E2E работает по http://localhost (это тоже secure context) на отдельных портах,
// чтобы не конфликтовать с запущенным dev-окружением.
const e2e = process.env.VCR_E2E === '1';
// В dev Node слушает localhost (на Windows это может быть ::1), в E2E — явно 127.0.0.1.
const serverTarget = e2e
  ? `http://127.0.0.1:${process.env.VCR_SERVER_PORT ?? '3100'}`
  : 'http://localhost:3000';

export default defineConfig({
  // Самоподписанный сертификат: без HTTPS браузер не даст камеру и микрофон при доступе по LAN.
  plugins: [react(), ...(e2e ? [] : [basicSsl()])],
  server: {
    host: e2e ? '127.0.0.1' : true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Same-origin: клиент подключается через io() без URL, Vite проксирует на Node.
      '/socket.io': { target: serverTarget, ws: true },
    },
  },
});
