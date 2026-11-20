import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { handleModelProxy } from '../src/ai/proxy';
import { handler } from '../functions/handler';
import config from '../vite.config';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const payload = { model: 'test-model', stream: true, messages: [] };
const body = { baseUrl: 'https://example.com/v1', apiKey: 'test-only', payload };
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (value?: Uint8Array) => new TextDecoder().decode(value);
const makeRequest = (signal?: AbortSignal) => new Request('https://local.test/api/model-proxy', {
  method: 'POST', body: JSON.stringify(body), signal,
});

function mockUpstream() {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const pull = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { source = controller; }, pull, cancel,
  }, { highWaterMark: 0 });
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return { source, cancel, pull, signal: () => fetchMock.mock.calls[0][1]!.signal!, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  ['local', handleModelProxy],
  ['cloud', handler],
] as const)('%s model proxy', (_name, proxy) => {
  it('delivers the first SSE bytes before upstream finishes, without altering the request', async () => {
    const upstream = mockUpstream();
    const first = 'data: {"delta":"客厅"}\n\n';
    upstream.source.enqueue(encode(first));
    const response = await proxy(makeRequest());
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, no-transform');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    const reader = response.body!.getReader();
    expect(decode((await reader.read()).value)).toBe(first);
    expect(upstream.signal().aborted).toBe(false);
    expect(upstream.cancel).not.toHaveBeenCalled();
    const [target, init] = upstream.fetchMock.mock.calls[0];
    expect(String(target)).toBe('https://example.com/v1/chat/completions');
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer test-only' } });
    expect(JSON.parse(init!.body as string)).toEqual(payload);
    upstream.source.enqueue(encode('data: [DONE]\n\n'));
    upstream.source.close();
    expect(decode((await reader.read()).value)).toBe('data: [DONE]\n\n');
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
  });

  it('aborts fetch and cancels the upstream reader when the returned body is cancelled', async () => {
    const upstream = mockUpstream();
    const response = await proxy(makeRequest());
    const reader = response.body!.getReader();
    const pending = reader.read();
    await reader.cancel('user stopped');
    expect((await pending).done).toBe(true);
    expect(upstream.signal().aborted).toBe(true);
    expect(upstream.signal().reason).toBe('user stopped');
    expect(upstream.cancel).toHaveBeenCalledWith('user stopped');
    reader.releaseLock();
  });

  it('propagates request abort during a pending read', async () => {
    const upstream = mockUpstream();
    const cancellation = new AbortController();
    const response = await proxy(makeRequest(cancellation.signal));
    const reader = response.body!.getReader();
    const reason = new DOMException('Stopped', 'AbortError');
    const rejected = expect(reader.read()).rejects.toBe(reason);
    cancellation.abort(reason);
    await rejected;
    expect(upstream.signal().reason).toBe(reason);
    expect(upstream.cancel).toHaveBeenCalledWith(reason);
    reader.releaseLock();
  });

  it('keeps the 290 second timeout active after response headers', async () => {
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const upstream = mockUpstream();
    const response = await proxy(makeRequest());
    const reader = response.body!.getReader();
    const reason = new DOMException('Timed out', 'TimeoutError');
    const rejected = expect(reader.read()).rejects.toBe(reason);
    timeout.abort(reason);
    await rejected;
    expect(timeoutSpy).toHaveBeenCalledWith(290_000);
    expect(upstream.signal().reason).toBe(reason);
    expect(upstream.cancel).toHaveBeenCalledWith(reason);
    reader.releaseLock();
  });

  it('aborts fetch while waiting for upstream headers', async () => {
    const started = deferred<AbortSignal>();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      started.resolve(signal);
    })));
    const cancellation = new AbortController();
    const pending = proxy(makeRequest(cancellation.signal));
    const signal = await started.promise;
    cancellation.abort();
    expect((await pending).status).toBe(502);
    expect(signal.aborted).toBe(true);
  });

  it('does not start fetch for an already aborted request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cancellation = new AbortController();
    cancellation.abort();
    await proxy(makeRequest(cancellation.signal));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'application/json', '{"choices":[]}'],
    [401, 'application/json; charset=utf-8', '{"error":{"message":"invalid key"}}'],
    [503, 'text/plain', 'temporarily unavailable'],
  ])('forwards status %i, content type and body unchanged', async (status, contentType, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text, {
      status, headers: { 'Content-Type': contentType },
    })));
    const response = await proxy(makeRequest());
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toBe(contentType);
    expect(await response.text()).toBe(text);
  });

  it('forwards a bodyless response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const response = await proxy(makeRequest());
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it('surfaces upstream stream errors after the first chunk', async () => {
    const upstream = mockUpstream();
    upstream.source.enqueue(encode('data: partial\n\n'));
    const reader = (await proxy(makeRequest())).body!.getReader();
    await reader.read();
    const reason = new Error('upstream disconnected');
    const rejected = expect(reader.read()).rejects.toBe(reason);
    upstream.source.error(reason);
    await rejected;
    reader.releaseLock();
  });

  it('removes cancellation listeners after a normal end', async () => {
    const upstream = mockUpstream();
    const cancellation = new AbortController();
    const response = await proxy(makeRequest(cancellation.signal));
    const remove = vi.spyOn(upstream.signal(), 'removeEventListener');
    upstream.source.close();
    await response.text();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    cancellation.abort();
    expect(upstream.cancel).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT', 'OPTIONS'])('rejects %s without calling upstream', async (method) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxy(new Request('https://local.test/api/model-proxy', { method }));
    expect(response.status).toBe(405);
    expect((await response.json()).error.message).toContain('POST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['{', JSON.stringify({ ...body, baseUrl: 'http://example.com' }), JSON.stringify({ ...body, apiKey: null })])(
    'preserves request validation for %s', async (invalidBody) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect((await proxy(new Request('https://local.test', { method: 'POST', body: invalidBody }))).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});

it('preserves cloud private-host and request-size guards', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  for (const baseUrl of ['https://localhost', 'https://127.0.0.1', 'https://192.168.1.1']) {
    expect((await handler(new Request('https://local.test', {
      method: 'POST', body: JSON.stringify({ ...body, baseUrl }),
    }))).status).toBe(400);
  }
  expect((await handler(new Request('https://local.test', {
    method: 'POST', body: '{}', headers: { 'content-length': String(16 * 1024 * 1024 + 1) },
  }))).status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void | Promise<void>;
function localBridge(path: string) {
  let middleware!: Middleware;
  const plugin = config.plugins![0] as {
    configureServer(server: { middlewares: { use(handler: Middleware): void } }): void;
  };
  plugin.configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST', url: path, aborted: false });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200, destroyed: false, writableEnded: false, writableFinished: false, headersSent: false,
    setHeader: vi.fn(), flushHeaders: vi.fn(), flush: vi.fn(),
    write: vi.fn<(chunk: Uint8Array) => boolean>().mockReturnValue(true),
    end: vi.fn(), destroy: vi.fn(),
  });
  return { req, res, run: () => Promise.resolve(middleware(req as unknown as IncomingMessage, res as unknown as ServerResponse, vi.fn())) };
}

describe('local Vite model-proxy bridge', () => {
  it.each(['/api/model-proxy', '/functions/v1/app'])('streams and respects backpressure on %s', async (path) => {
    const upstream = mockUpstream();
    upstream.source.enqueue(encode('data: first\n\n'));
    const { req, res, run } = localBridge(path);
    const firstWrite = deferred<void>();
    res.write.mockImplementationOnce(() => { firstWrite.resolve(); return false; });
    const done = run();
    await firstWrite.promise;
    expect(decode(res.write.mock.calls[0][0])).toBe('data: first\n\n');
    expect(res.flushHeaders).toHaveBeenCalledOnce();
    expect(res.flush).toHaveBeenCalledOnce();
    expect(res.setHeader).toHaveBeenCalledWith('x-accel-buffering', 'no');
    expect(res.end).not.toHaveBeenCalled();
    expect(upstream.pull).not.toHaveBeenCalled();
    // A completed upload must not abort a still-running model response.
    req.emit('close');
    expect(upstream.signal().aborted).toBe(false);
    upstream.source.enqueue(encode('data: last\n\n'));
    upstream.source.close();
    expect(res.write).toHaveBeenCalledTimes(1);
    res.emit('drain');
    await done;
    expect(decode(res.write.mock.calls[1][0])).toBe('data: last\n\n');
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.listenerCount('close')).toBe(0);
    expect(res.listenerCount('error')).toBe(0);
    expect(res.listenerCount('drain')).toBe(0);
    expect(req.listenerCount('aborted')).toBe(0);
  });

  it.each([true, false])('cancels upstream on disconnect (write accepted: %s)', async (writable) => {
    const upstream = mockUpstream();
    upstream.source.enqueue(encode('data: first\n\n'));
    const { req, res, run } = localBridge('/api/model-proxy');
    const firstWrite = deferred<void>();
    res.write.mockImplementationOnce(() => { firstWrite.resolve(); return writable; });
    const done = run();
    await firstWrite.promise;
    res.destroyed = true;
    res.emit('close');
    await done;
    expect(upstream.signal().aborted).toBe(true);
    expect(upstream.cancel).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
    expect(res.listenerCount('close')).toBe(0);
    expect(res.listenerCount('error')).toBe(0);
    expect(res.listenerCount('drain')).toBe(0);
    expect(req.listenerCount('aborted')).toBe(0);
  });
});
