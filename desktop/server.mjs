import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function readProjectSource(root, graph, requested) {
  if (!requested || requested.includes('\0') || path.isAbsolute(requested)) throw new Error('无效文件路径');
  const absolute = path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('文件超出项目目录');
  const allowed = graph?.nodes.some(node => node.filePath?.replaceAll('\\', '/') === relative.replaceAll('\\', '/'));
  if (!allowed) throw new Error('文件不在知识图谱中');
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(absolute);
  const resolved = path.relative(realRoot, real);
  if (resolved.startsWith('..') || path.isAbsolute(resolved)) throw new Error('不允许读取项目外的链接文件');
  const stat = await fs.stat(real);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('文件超过 1 MB 或不是普通文件');
  const content = await fs.readFile(real, 'utf8');
  if (content.includes('\0')) throw new Error('无法显示二进制文件');
  const language = { ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', py: 'python', md: 'markdown', yml: 'yaml', rs: 'rust', cs: 'csharp', sh: 'bash', html: 'markup' }[path.extname(real).slice(1)] || path.extname(real).slice(1) || 'text';
  return { path: relative.replaceAll('\\', '/'), content, language, sizeBytes: stat.size, lineCount: content.split('\n').length };
}

export async function startServer({ appRoot, getProject }) {
  const token = crypto.randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const json = (code, payload) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'");
    try {
      const address = server.address();
      const origin = `http://127.0.0.1:${address.port}`;
      if (req.headers.host !== `127.0.0.1:${address.port}`) return json(403, { error: 'Invalid host' });
      const url = new URL(req.url, origin);
      if (req.method !== 'GET') return json(405, { error: 'Read only' });
      const { root, graph } = getProject();
      if (url.pathname.endsWith('.json')) {
        if (url.searchParams.get('token') !== token) return json(401, { error: 'Unauthorized' });
        if (url.pathname === '/knowledge-graph.json') return json(graph ? 200 : 404, graph || { error: '尚无图谱' });
        if (url.pathname === '/config.json') return json(200, { autoUpdate: false, outputLanguage: 'zh' });
        if (url.pathname === '/meta.json') return json(200, {});
        if (url.pathname === '/staleness.json') return json(200, { graphs: { knowledge: { status: 'unknown', reason: 'missing-graph-commit' } } });
        if (url.pathname === '/file-content.json' && root && graph) return json(200, await readProjectSource(root, graph, url.searchParams.get('path')));
        return json(404, { error: 'Not found' });
      }
      let base, relative;
      if (url.pathname.startsWith('/viewer/')) { base = path.join(appRoot, 'dist-viewer'); relative = decodeURIComponent(url.pathname.slice('/viewer/'.length)) || 'index.html'; }
      else { base = path.join(appRoot, 'desktop/ui'); relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)); }
      const file = path.resolve(base, relative);
      const rel = path.relative(base, file);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return json(403, { error: 'Forbidden' });
      const content = await fs.readFile(file);
      const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type }); res.end(content);
    } catch (error) { json(error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, token, origin: `http://127.0.0.1:${server.address().port}` };
}
