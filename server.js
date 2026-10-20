import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');
const historyDir = path.resolve(process.env.STUDIO_HISTORY_DIR || path.join(rootDir, '.history'));
const dataFile = path.resolve(process.env.MOCKOON_DATA_FILE || path.join(rootDir, 'data', 'sample-environment.json'));
const host = process.env.STUDIO_HOST || '127.0.0.1';
const port = Number(process.env.STUDIO_PORT || 4173);
const maxBodyBytes = 15 * 1024 * 1024;

const runtime = {
  adminUrl: normalizeAdminUrl(process.env.MOCKOON_ADMIN_URL || 'http://127.0.0.1:3000'),
  adminToken: process.env.MOCKOON_ADMIN_TOKEN || '',
  autoPush: process.env.MOCKOON_AUTO_PUSH === 'true'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function normalizeAdminUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\/mockoon-admin$/, '');
}

function adminEndpoint(suffix) {
  return `${runtime.adminUrl}/mockoon-admin${suffix}`;
}

function adminHeaders(extra = {}) {
  return {
    ...(runtime.adminToken ? { Authorization: `Bearer ${runtime.adminToken}` } : {}),
    ...extra
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, { ok: false, error: message, ...(details ? { details } : {}) });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error('Request body is larger than 15 MB'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
  }
}

function validateEnvironment(environment) {
  const errors = [];
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) errors.push('Environment must be a JSON object.');
  if (!environment?.uuid || typeof environment.uuid !== 'string') errors.push('Environment uuid is required.');
  if (!environment?.name || typeof environment.name !== 'string') errors.push('Environment name is required.');
  if (!Array.isArray(environment?.routes)) errors.push('Environment routes must be an array.');
  environment?.routes?.forEach((route, index) => {
    if (!route.uuid) errors.push(`Route ${index + 1} is missing uuid.`);
    if (!route.method) errors.push(`Route ${index + 1} is missing method.`);
    if (typeof route.endpoint !== 'string') errors.push(`Route ${index + 1} is missing endpoint.`);
    if (!Array.isArray(route.responses) || route.responses.length === 0) errors.push(`Route ${index + 1} must have at least one response.`);
  });
  return errors;
}

async function ensureDirectories() {
  await mkdir(path.dirname(dataFile), { recursive: true });
  await mkdir(historyDir, { recursive: true });
}

async function loadEnvironment() {
  const source = await readFile(dataFile, 'utf8');
  return JSON.parse(source);
}

async function snapshotCurrent(reason = 'autosave') {
  try {
    const source = await readFile(dataFile, 'utf8');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeReason = String(reason).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'save';
    const filename = `${timestamp}__${safeReason}.json`;
    await writeFile(path.join(historyDir, filename), source, 'utf8');
    return filename;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

async function writeEnvironment(environment, reason = 'save') {
  await ensureDirectories();
  const snapshot = await snapshotCurrent(reason);
  const tempPath = `${dataFile}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(environment, null, 2)}\n`, 'utf8');
  await rename(tempPath, dataFile);
  return snapshot;
}

async function pushEnvironment(environment) {
  if (!runtime.adminUrl) throw Object.assign(new Error('Mockoon Admin URL is not configured.'), { statusCode: 400 });
  const response = await fetch(adminEndpoint('/environment'), {
    method: 'PUT',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(environment),
    signal: AbortSignal.timeout(8000)
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(`Mockoon Admin API returned ${response.status}`), {
      statusCode: 502,
      details: responseText.slice(0, 1000)
    });
  }
  return { status: response.status, body: responseText };
}

async function listHistory() {
  await ensureDirectories();
  const names = (await readdir(historyDir)).filter((name) => name.endsWith('.json')).sort().reverse();
  const entries = await Promise.all(names.slice(0, 100).map(async (name) => {
    const info = await stat(path.join(historyDir, name));
    const [datePart, reasonPart = 'save.json'] = name.split('__');
    return {
      id: name,
      createdAt: info.mtime.toISOString(),
      reason: reasonPart.replace(/\.json$/, '').replace(/-/g, ' '),
      size: info.size,
      label: datePart.replace(/-(\d{3})Z$/, '.$1Z')
    };
  }));
  return entries;
}

async function proxyLogs(res) {
  if (!runtime.adminUrl) return sendError(res, 400, 'Mockoon Admin URL is not configured.');
  const response = await fetch(adminEndpoint('/logs'), {
    headers: adminHeaders(),
    signal: AbortSignal.timeout(6000)
  });
  const text = await response.text();
  if (!response.ok) return sendError(res, 502, `Mockoon Admin API returned ${response.status}`, text.slice(0, 1000));
  res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

async function proxyEvents(req, res) {
  if (!runtime.adminUrl) return sendError(res, 400, 'Mockoon Admin URL is not configured.');
  const upstream = await fetch(adminEndpoint('/events?maxlogs=50'), {
    headers: adminHeaders({ Accept: 'text/event-stream' }),
    signal: AbortSignal.timeout(24 * 60 * 60 * 1000)
  });
  if (!upstream.ok || !upstream.body) return sendError(res, 502, `Mockoon event stream returned ${upstream.status}`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(': connected\n\n');
  const reader = upstream.body.getReader();
  const abort = () => reader.cancel().catch(() => {});
  req.on('close', abort);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    req.off('close', abort);
    res.end();
  }
}

async function serveStatic(pathname, res) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(requested);
  const absolutePath = path.resolve(publicDir, `.${decoded}`);
  if (!absolutePath.startsWith(publicDir + path.sep) && absolutePath !== path.join(publicDir, 'index.html')) {
    return sendError(res, 403, 'Forbidden');
  }
  try {
    const info = await stat(absolutePath);
    if (!info.isFile()) return sendError(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(absolutePath)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': path.extname(absolutePath) === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    createReadStream(absolutePath).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') return sendError(res, 404, 'Not found');
    throw error;
  }
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'Mockoon Live Studio' });
  }

  if (req.method === 'GET' && url.pathname === '/api/settings') {
    return sendJson(res, 200, {
      ok: true,
      settings: {
        dataFile,
        adminUrl: runtime.adminUrl,
        hasAdminToken: Boolean(runtime.adminToken),
        autoPush: runtime.autoPush
      }
    });
  }

  if (req.method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readJsonBody(req);
    if ('adminUrl' in body) runtime.adminUrl = normalizeAdminUrl(body.adminUrl);
    if ('adminToken' in body && body.adminToken !== '••••••••') runtime.adminToken = String(body.adminToken || '');
    if ('autoPush' in body) runtime.autoPush = Boolean(body.autoPush);
    return sendJson(res, 200, { ok: true, settings: { adminUrl: runtime.adminUrl, hasAdminToken: Boolean(runtime.adminToken), autoPush: runtime.autoPush } });
  }

  if (req.method === 'GET' && url.pathname === '/api/environment') {
    const environment = await loadEnvironment();
    const info = await stat(dataFile);
    return sendJson(res, 200, { ok: true, environment, metadata: { dataFile, updatedAt: info.mtime.toISOString(), size: info.size } });
  }

  if (req.method === 'PUT' && url.pathname === '/api/environment') {
    const body = await readJsonBody(req);
    const environment = body.environment ?? body;
    const errors = validateEnvironment(environment);
    if (errors.length) return sendJson(res, 422, { ok: false, error: 'Environment validation failed.', errors });
    const snapshot = await writeEnvironment(environment, body.reason || 'save');
    let live = null;
    if (runtime.autoPush || body.push === true) {
      try {
        live = { ok: true, ...(await pushEnvironment(environment)) };
      } catch (error) {
        live = { ok: false, error: error.message, details: error.details };
      }
    }
    return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), snapshot, live });
  }

  if (req.method === 'POST' && url.pathname === '/api/environment/push') {
    const body = await readJsonBody(req);
    const environment = body.environment || await loadEnvironment();
    const result = await pushEnvironment(environment);
    return sendJson(res, 200, { ok: true, ...result, pushedAt: new Date().toISOString() });
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/status') {
    if (!runtime.adminUrl) return sendJson(res, 200, { ok: true, connected: false, reason: 'Admin URL is not configured.' });
    try {
      const response = await fetch(adminEndpoint('/logs'), { headers: adminHeaders(), signal: AbortSignal.timeout(4000) });
      return sendJson(res, 200, { ok: true, connected: response.ok, status: response.status, adminUrl: runtime.adminUrl });
    } catch (error) {
      return sendJson(res, 200, { ok: true, connected: false, reason: error.message, adminUrl: runtime.adminUrl });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/logs') return proxyLogs(res);
  if (req.method === 'GET' && url.pathname === '/api/events') return proxyEvents(req, res);

  if (req.method === 'GET' && url.pathname === '/api/history') {
    return sendJson(res, 200, { ok: true, history: await listHistory() });
  }

  const restoreMatch = url.pathname.match(/^\/api\/history\/([^/]+)\/restore$/);
  if (req.method === 'POST' && restoreMatch) {
    const id = path.basename(decodeURIComponent(restoreMatch[1]));
    if (!id.endsWith('.json')) return sendError(res, 400, 'Invalid history entry.');
    const source = await readFile(path.join(historyDir, id), 'utf8');
    const environment = JSON.parse(source);
    const errors = validateEnvironment(environment);
    if (errors.length) return sendJson(res, 422, { ok: false, error: 'History entry is invalid.', errors });
    await writeEnvironment(environment, 'before-restore');
    return sendJson(res, 200, { ok: true, environment, restoredFrom: id });
  }

  return sendError(res, 404, 'API endpoint not found.');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendError(res, error.statusCode || 500, error.message || 'Internal server error', error.details);
    else res.end();
  }
});

await ensureDirectories();
try {
  await access(dataFile);
} catch {
  console.error(`Environment file not found: ${dataFile}`);
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`Mockoon Live Studio: http://${host}:${port}`);
  console.log(`Environment file: ${dataFile}`);
});

