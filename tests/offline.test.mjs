import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { validateSettings, listModels, complete } from '../desktop/model.mjs';
import { startServer, readProjectSource } from '../desktop/server.mjs';
import { analyzeProject, loadGraph, scanProject, validateGraph, answerQuestion } from '../dist-desktop/engine.mjs';

test('compatible settings accept IP and domain endpoints and migrate existing providers', () => {
  for (const baseUrl of ['file:///tmp/model', 'ftp://192.168.0.1/v1', 'http://user:pass@localhost/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment']) {
    assert.throws(() => validateSettings({ baseUrl }));
  }
  for (const baseUrl of ['https://api.example.com/v1', 'http://192.168.0.1:8000/v1', 'http://[2001:db8::1]:8000/v1']) {
    assert.equal(validateSettings({ baseUrl }).baseUrl, baseUrl);
  }
  for (const provider of ['ollama', 'lmstudio']) {
    const migrated = validateSettings({ provider, baseUrl: 'http://192.168.0.1:8000/v1', model: 'custom:cloud', apiKey: 'existing-key' });
    assert.equal(migrated.provider, 'openai-compatible');
    assert.equal(migrated.model, 'custom:cloud');
    assert.equal(migrated.apiKey, 'existing-key');
  }
  assert.equal(validateSettings({ baseUrl: 'http://localhost:1234/' }).baseUrl, 'http://127.0.0.1:1234/v1');
});

test('local service, cached analysis, source access, chat, cancellation and deletion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ua-offline-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(root, 'src/main.ts'), "import { hello } from './helper.js';\nexport function start() { return hello(); }\n");
  await fs.writeFile(path.join(root, 'src/helper.ts'), "export function hello() { return 'hi'; }\n");
  await fs.writeFile(path.join(root, '.env'), 'SECRET=never-read');
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules/ignored.ts'), 'export const ignored = 1;');
  await fs.writeFile(path.join(root, 'skip.ts'), 'export const skip = 1;');
  await fs.writeFile(path.join(root, '.understandignore'), 'skip.ts\n');
  const scanned = await scanProject(root);
  assert.deepEqual(scanned.files, ['src/helper.ts', 'src/main.ts']);
  let calls = 0;
  const model = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fixture-local' }, { id: 'blocked:cloud' }] }));
    if (req.url === '/redirect/models') { res.writeHead(302, { Location: 'http://example.com/' }); return res.end(); }
    let body = ''; for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    calls++;
    assert.equal(parsed.model, 'fixture-local');
    const analysis = JSON.stringify({ fileSummary: '测试文件的中文说明', tags: ['测试'], complexity: 'simple', functionSummaries: { hello: '返回问候', start: '程序入口' }, classSummaries: {} });
    const content = parsed.messages[0].content.includes('代码库助手') ? '入口在 src/main.ts 的 start 函数。' : analysis;
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  t.after(() => model.close());
  const settings = validateSettings({ baseUrl: `http://127.0.0.1:${model.address().port}/v1`, model: 'fixture-local' });
  assert.deepEqual(await listModels(settings), ['fixture-local', 'blocked:cloud']);
  await assert.rejects(listModels({ ...settings, baseUrl: `http://127.0.0.1:${model.address().port}/redirect` }));
  const events = [];
  const graph = await analyzeProject(root, settings, {}, new AbortController().signal, event => events.push(event));
  assert.equal(validateGraph(graph).success, true);
  assert.ok(graph.nodes.some(n => n.id === 'function:src/main.ts:start'));
  assert.ok(graph.edges.some(e => e.type === 'imports' && e.target === 'file:src/helper.ts'));
  assert.equal(calls, 2);
  assert.equal(graph.nodes.find(n => n.id === 'file:src/main.ts').summary, '测试文件的中文说明');
  await analyzeProject(root, settings, {}, new AbortController().signal, () => {});
  assert.equal(calls, 2, 'unchanged files reuse model results');
  assert.match(await answerQuestion(graph, '入口在哪里？', settings, new AbortController().signal), /src\/main.ts/);
  const loaded = await loadGraph(root);
  assert.equal(loaded.nodes.length, graph.nodes.length);
  const source = await readProjectSource(root, graph, 'src/main.ts');
  assert.match(source.content, /function start/);
  assert.ok(source.sizeBytes > 0);
  await assert.rejects(readProjectSource(root, graph, '../outside.ts'));
  await assert.rejects(readProjectSource(root, graph, '.env'));
  const aborted = new AbortController(); aborted.abort(new Error('cancelled'));
  await assert.rejects(analyzeProject(root, settings, {}, aborted.signal, () => {}), /cancelled/);
  assert.deepEqual(await loadGraph(root), loaded, 'cancellation preserves graph');
  const transport = await startServer({ appRoot: process.cwd(), getProject: () => ({ root, graph }) });
  t.after(() => transport.server.close());
  assert.equal((await fetch(transport.origin + '/knowledge-graph.json')).status, 401);
  assert.equal((await fetch(transport.origin + '/knowledge-graph.json?token=' + transport.token)).status, 200);
  const ui = await fetch(transport.origin + '/');
  assert.match(ui.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await ui.text(), /模型分析/);
  const file = await fetch(transport.origin + '/file-content.json?path=src/main.ts&token=' + transport.token);
  assert.match((await file.json()).content, /function start/);
  await fs.rm(path.join(root, 'src/helper.ts'));
  const updated = await analyzeProject(root, settings, {}, new AbortController().signal, () => {});
  assert.ok(!updated.nodes.some(n => n.filePath === 'src/helper.ts'));
  assert.ok(!updated.edges.some(e => e.target === 'file:src/helper.ts'));
});

test('static analysis needs no model service', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ua-static-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app.py'), 'def run():\n    return 42\n');
  const graph = await analyzeProject(root, validateSettings({}), { structuralOnly: true }, new AbortController().signal, () => {});
  assert.ok(graph.nodes.some(n => n.type === 'function' && n.name === 'run'));
  assert.equal(validateGraph(graph).success, true);
});
