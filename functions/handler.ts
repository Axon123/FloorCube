interface ProxyBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  payload?: unknown;
}

const MAX_BODY_BYTES = 16 * 1024 * 1024;

function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: { message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

function forwardStream(body: ReadableStream<Uint8Array>, cancellation: AbortController, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let settled = false;
  let onAbort: () => void;
  const cleanup = () => {
    settled = true;
    signal.removeEventListener("abort", onAbort);
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
      signal.addEventListener("abort", onAbort, { once: true });
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

// Stateless BYOK forwarder: the key is used only for this one upstream call,
// never stored, logged or cached.
export async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { error: { message: "仅支持 POST 转发。" } },
      { status: 405, headers: { "Cache-Control": "no-store", Allow: "POST" } },
    );
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    return jsonError("转发请求体过大。", 413);
  }
  let body: ProxyBody;
  try {
    body = await request.json() as ProxyBody;
  } catch {
    return jsonError("转发请求不是有效 JSON。", 400);
  }
  if (
    typeof body.baseUrl !== "string" ||
    typeof body.apiKey !== "string" ||
    typeof body.payload !== "object" ||
    body.payload === null
  ) {
    return jsonError("缺少接口地址、Key 或请求体。", 400);
  }
  let target: URL;
  try {
    target = new URL(body.baseUrl.replace(/\/$/, "") + "/chat/completions");
  } catch {
    return jsonError("接口地址格式无效。", 400);
  }
  if (target.protocol !== "https:") {
    return jsonError("转发函数仅允许 HTTPS 接口；本地 HTTP 接口请由浏览器直连。", 400);
  }
  if (isPrivateHost(target.hostname)) {
    return jsonError("接口地址不能指向本机或内网，请使用可公开访问的 HTTPS 接口。", 400);
  }
  try {
    const cancellation = new AbortController();
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(290_000), cancellation.signal]);
    signal.throwIfAborted();
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify(body.payload),
      signal,
    });
    return new Response(upstream.body ? forwardStream(upstream.body, cancellation, signal) : null, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store, no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return jsonError("转发请求失败，请检查接口地址是否可公开访问。", 502);
  }
}
