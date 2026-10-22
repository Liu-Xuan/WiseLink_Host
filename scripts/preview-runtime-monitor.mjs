#!/usr/bin/env node
// Isolated local replay of the production diagnostic component. No Host proxy.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  configFile: false,
  root: `${root}client`,
  resolve: { alias: { '@shared': `${root}shared`, '@client': `${root}client`, '@': `${root}client/src` } },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
});
await server.listen();
console.log('Local replay: http://127.0.0.1:5180/monitor-preview.html');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
