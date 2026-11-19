import { defineConfig } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleModelProxy } from './src/ai/proxy';

function modelProxyPlugin() {
  return {
    name: 'floorcube-model-proxy',
    configureServer(server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/model-proxy')) return next();
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: { message: '仅支持 POST。' } }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const request = new Request('http://localhost/api/model-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.concat(chunks).toString('utf8'),
        });
        const response = await handleModelProxy(request);
        res.statusCode = response.status;
        res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'application/json');
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [modelProxyPlugin()],
  build: {
    chunkSizeWarningLimit: 700,
  },
});
