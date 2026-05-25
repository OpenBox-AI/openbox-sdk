// Self-hosted webhook receiver. Listens for cloud-agent completion
// payloads (Cursor cloud agents, bugbot, any other webhook-fed
// agentic flow) and runs them through OpenBox governance before the
// upstream surface acts on the result.
//
// Single binary by design: minimal Node http server, no framework.
// Two endpoints:
//
//   POST /webhook  → run governance, return verdict JSON
//   GET  /healthz  → 200 OK if the OpenBox API is reachable
//
// Signature verification (HMAC) is best-effort: providers that send
// a signing secret get verified; providers that don't fall back to
// a shared bearer token in `Authorization`. Both modes are documented
// in the README.
import http from 'node:http';
import { handleWebhook } from './handler.js';

const PORT = Number(process.env.OPENBOX_BRIDGE_PORT ?? 8787);
const HOST = process.env.OPENBOX_BRIDGE_HOST ?? '127.0.0.1';

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

if (process.env.OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV === '1' && !isLoopbackHost(HOST)) {
  throw new Error('OPENBOX_BRIDGE_UNSAFE_LOCAL_DEV is only allowed on loopback hosts');
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf-8');
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (req.method === 'POST' && url === '/webhook') {
    let body = '';
    try {
      body = await readBody(req);
      const result = await handleWebhook({
        rawBody: body,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : (v ?? '')]),
        ),
      });
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      const msg = (err as Error).message ?? 'unknown';
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[openbox cloud-bridge] listening on http://${HOST}:${PORT}`);
});
