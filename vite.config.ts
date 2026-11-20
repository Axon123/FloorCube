import { defineConfig } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleModelProxy } from './src/ai/proxy';

function modelProxyPlugin() {
  return {
    name: 'floorcube-model-proxy',
    configureServer(server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/functions/v1/app') && !req.url?.startsWith('/api/model-proxy')) return next();
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: { message: '仅支持 POST。' } }));
          return;
        }
        const cancellation = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const onDisconnect = () => {
          if (!res.writableFinished) cancellation.abort(new DOMException('Client disconnected', 'AbortError'));
        };
        // Request "close" also fires after a normal upload; watch response close instead.
        req.once('aborted', onDisconnect);
        res.once('close', onDisconnect);
        res.once('error', onDisconnect);
        const waitForDrain = () => new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            res.off('drain', onDrain);
            cancellation.signal.removeEventListener('abort', onAbort);
          };
          const onDrain = () => { cleanup(); resolve(); };
          const onAbort = () => { cleanup(); reject(cancellation.signal.reason); };
          res.once('drain', onDrain);
          cancellation.signal.addEventListener('abort', onAbort, { once: true });
          if (cancellation.signal.aborted) onAbort();
        });
        try {
          if (req.aborted || res.destroyed) onDisconnect();
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          cancellation.signal.throwIfAborted();
          const request = new Request('http://localhost/api/model-proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.concat(chunks).toString('utf8'),
            signal: cancellation.signal,
          });
          const response = await handleModelProxy(request);
          reader = response.body?.getReader();
          cancellation.signal.throwIfAborted();
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.flushHeaders();
          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            const writable = res.write(value);
            (res as ServerResponse & { flush?: () => void }).flush?.();
            if (!writable) await waitForDrain();
          }
          res.end();
        } catch (error) {
          cancellation.abort(error);
          if (!res.destroyed && !res.writableEnded) {
            if (res.headersSent) {
              res.destroy();
            } else {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: { message: '转发请求失败，请检查接口地址是否可公开访问。' } }));
            }
          }
        } finally {
          req.off('aborted', onDisconnect);
          res.off('close', onDisconnect);
          res.off('error', onDisconnect);
          if (reader) {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
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
