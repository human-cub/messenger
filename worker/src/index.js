// Прокси к Supabase: принимает любой path, шлёт в TARGET_HOST,
// возвращает ответ с открытыми CORS-заголовками.
// Также прокидывает WebSocket (Realtime) через Upgrade.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

const STRIP_REQ_HEADERS = new Set([
  'host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
  'x-forwarded-for', 'x-forwarded-proto', 'x-real-ip', 'content-length'
]);

export default {
  async fetch(request, env) {
    const targetHost = env.TARGET_HOST;
    const url = new URL(request.url);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Health-check на корень
    if (url.pathname === '/' || url.pathname === '/__health') {
      return new Response('ok ' + targetHost, {
        status: 200,
        headers: { 'Content-Type': 'text/plain', ...CORS }
      });
    }

    // WebSocket (Supabase Realtime)
    const upgrade = request.headers.get('Upgrade');
    if (upgrade && upgrade.toLowerCase() === 'websocket') {
      const targetWs = 'https://' + targetHost + url.pathname + url.search;
      // Cloudflare Workers — fetch с Upgrade=websocket делает passthrough
      return fetch(targetWs, request);
    }

    // Обычный HTTP-запрос
    const targetUrl = 'https://' + targetHost + url.pathname + url.search;
    const headers = new Headers();
    for (const [k, v] of request.headers.entries()) {
      if (!STRIP_REQ_HEADERS.has(k.toLowerCase())) headers.set(k, v);
    }

    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'manual'
      });
    } catch (e) {
      return new Response(JSON.stringify({ proxy_error: String(e) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...CORS }
      });
    }

    const respHeaders = new Headers(upstream.headers);
    for (const [k, v] of Object.entries(CORS)) respHeaders.set(k, v);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders
    });
  }
};
