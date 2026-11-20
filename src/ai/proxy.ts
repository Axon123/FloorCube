interface ProxyBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  payload?: unknown;
}

function forwardStream(body: ReadableStream<Uint8Array>, cancellation: AbortController, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let settled = false;
  let onAbort: () => void;
  const cleanup = () => {
    settled = true;
    signal.removeEventListener('abort', onAbort);
  };
  const cancelReader = (reason: unknown) => reader.cancel(reason).catch(() => {}).finally(() => reader.releaseLock());
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        if (settled) return;
        cleanup();
        controller.error(signal.reason);
        void cancelReader(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (settled) return;
        if (done) {
          cleanup();
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        if (settled) return;
        cleanup();
        reader.releaseLock();
        controller.error(error);
      }
    },
    cancel(reason) {
      cleanup();
      cancellation.abort(reason);
      return cancelReader(reason);
    },
  }, { highWaterMark: 0 });
}

export async function handleModelProxy(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: { message: '仅支持 POST 转发。' } }, { status: 405 });
  }
  let body: ProxyBody;
  try {
    body = await request.json() as ProxyBody;
  } catch {
    return Response.json({ error: { message: '转发请求不是有效 JSON。' } }, { status: 400 });
  }
  if (typeof body.baseUrl !== 'string' || typeof body.apiKey !== 'string' || typeof body.payload !== 'object' || body.payload === null) {
    return Response.json({ error: { message: '缺少接口地址、Key 或请求体。' } }, { status: 400 });
  }
  let target: URL;
  try {
    target = new URL(body.baseUrl.replace(/\/$/, '') + '/chat/completions');
  } catch {
    return Response.json({ error: { message: '接口地址格式无效。' } }, { status: 400 });
  }
  if (target.protocol !== 'https:') {
    return Response.json({ error: { message: '转发函数仅允许 HTTPS 接口；本地 HTTP 接口请由浏览器直连。' } }, { status: 400 });
  }
  try {
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(290_000), cancellation.signal]);
    signal.throwIfAborted();
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify(body.payload),
      signal,
    });
    return new Response(upstream.body ? forwardStream(upstream.body, cancellation, signal) : null, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
        'Cache-Control': 'no-store, no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch {
    return Response.json({ error: { message: '转发请求失败，请检查接口地址是否可公开访问。' } }, { status: 502 });
  }
}
