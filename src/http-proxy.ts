import Fastify from 'fastify';
import { spawn } from 'child_process';
import { v4 as uuid } from 'uuid';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = parseInt(process.env.PORT || '8080', 10);
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;
const VAULT_PATH = process.env.VAULT_PATH || '/data/vault';

if (!AUTH0_DOMAIN) {
  console.error('ERROR: AUTH0_DOMAIN environment variable must be set');
  process.exit(1);
}

if (!AUTH0_AUDIENCE) {
  console.error('ERROR: AUTH0_AUDIENCE environment variable must be set');
  process.exit(1);
}

const issuerBase = (/^https?:\/\//.test(AUTH0_DOMAIN) ? AUTH0_DOMAIN : `https://${AUTH0_DOMAIN}`)
  .replace(/\/+$/, '');
const issuer = `${issuerBase}/`;
const jwks = createRemoteJWKSet(new URL(`${issuerBase}/.well-known/jwks.json`));

/* ── spawn the existing MCP server ───────────────── */
const mcp = spawn('node', ['dist/src/index.js', VAULT_PATH], {
  stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
});

mcp.once('exit', (code, signal) => {
  console.error(
    `MCP server exited${code !== null ? ` with code ${code}` : ''}${signal ? ` (signal ${signal})` : ''}`,
  );
  process.exit(code ?? 1);
});

mcp.once('error', (error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});

/* read replies line-by-line */
type Resolver = (msg: unknown) => void;
const pending = new Map<string, Resolver>();

mcp.stdout.setEncoding('utf8').on('data', (chunk) => {
  chunk.split('\n').filter(Boolean).forEach((line: string) => {
    try {
      const msg = JSON.parse(line);
      const { id } = msg;
      if (pending.has(id)) {
        pending.get(id)!(msg);
        pending.delete(id);
      }
    } catch { /* ignore parse errors */ }
  });
});

/* helper to send a JSON-RPC object and wait for its reply */
function callMCP(msg: unknown): Promise<unknown> {
  const id = (msg as any).id ?? uuid();
  return new Promise<unknown>((resolve) => {
    pending.set(id, resolve);
    mcp.stdin.write(JSON.stringify({ ...(msg as object), id }) + '\n');
  });
}

/* ── HTTP façade ─────────────────────────────────── */
const app = Fastify();

app.addHook('onRequest', async (req, res) => {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    res.code(401);
    return res.send({ error: 'missing bearer token' });
  }

  const token = authorization.slice('Bearer '.length).trim();
  try {
    await jwtVerify(token, jwks, {
      issuer,
      audience: AUTH0_AUDIENCE,
    });
  } catch (err) {
    console.error('JWT verification failed', err);
    res.code(401);
    return res.send({ error: 'invalid token' });
  }
});

app.post('/mcp', async (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    res.code(400);
    return res.send({ error: 'invalid JSON body' });
  }

  const reply = await callMCP(req.body);
  res.send(reply);
});

app.listen({ port: PORT, host: '0.0.0.0' }, () =>
  console.error(`HTTP proxy listening on :${PORT}`),
);
