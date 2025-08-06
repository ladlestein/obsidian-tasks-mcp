import Fastify from 'fastify';
import { spawn } from 'child_process';
import { v4 as uuid } from 'uuid';

const PORT = parseInt(process.env.PORT || '8080', 10);
const TOKEN = process.env.MCP_TOKEN;
const VAULT_PATH = process.env.VAULT_PATH || '/data/vault';

if (!TOKEN) {
  console.error('ERROR: MCP_TOKEN environment variable must be set');
  process.exit(1);
}

/* ── spawn the existing MCP server ───────────────── */
const mcp = spawn('node', ['dist/src/index.js', VAULT_PATH], {
  stdio: ['pipe', 'pipe', 'inherit'], // stdin, stdout, stderr
});

type Resolver = (msg: unknown) => void;
const pending = new Map<string, Resolver>();

/* read replies line-by-line */
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
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.code(401).send({ error: 'unauthorized' });
  }
});

app.post('/mcp', async (req, res) => {
  const reply = await callMCP(req.body);
  res.send(reply);
});

app.listen({ port: PORT, host: '0.0.0.0' }, () =>
  console.error(`HTTP proxy listening on :${PORT}`),
);
