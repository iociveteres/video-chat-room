import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@vcr/protocol-tests',
    // Сервер и socket.io-client работают в Node; RTCPeerConnection стенду не нужен.
    environment: 'node',
    testTimeout: 30_000,
  },
});
