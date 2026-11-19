interface ProxyBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  payload?: unknown;
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
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${body.apiKey}`,
      },
      body: JSON.stringify(body.payload),
      signal: AbortSignal.timeout(290_000),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch {
    return Response.json({ error: { message: '转发请求失败，请检查接口地址是否可公开访问。' } }, { status: 502 });
  }
}
