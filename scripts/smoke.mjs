import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ua-ui-fixture-'));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'ua-ui-profile-'));
await fs.writeFile(path.join(fixture, 'main.ts'), "import { helper } from './helper';\nexport function main() { return helper(); }\n");
await fs.writeFile(path.join(fixture, 'helper.ts'), 'export function helper() { return 42; }\n');
let modelCalls = 0;
const service = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'local-test-model' }] }));
  let body = ''; for await (const chunk of req) body += chunk;
  const data = JSON.parse(body); modelCalls++;
  const content = data.messages[0].content.includes('代码分析助手')
    ? JSON.stringify({ fileSummary: '这是模型生成的测试摘要。', tags: ['测试'], complexity: 'simple', functionSummaries: { main: '项目入口', helper: '返回数字' }, classSummaries: {} })
    : data.messages[0].content.includes('代码库助手') ? '项目入口在 main.ts 中。' : '模型连接成功';
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
await new Promise(resolve => service.listen(0, '0.0.0.0', resolve));
const lanAddress = Object.values(os.networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'))?.address || '127.0.0.2';
const modelBase = `http://${lanAddress}:${service.address().port}/v1`;
const packaged = process.argv.includes('--packaged');
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  executablePath: packaged ? path.resolve('release/win-unpacked/Understand Anything Desktop.exe') : undefined,
  args: packaged ? [`--user-data-dir=${profile}`] : ['.', `--user-data-dir=${profile}`],
  env: launchEnv, timeout: 30000,
});
try {
  const page = await application.firstWindow();
  await application.evaluate(() => {
    globalThis.modelRequestLog = [];
    const original = globalThis.fetch;
    globalThis.fetch = (...args) => { globalThis.modelRequestLog.push(String(args[0])); return original(...args); };
  });
  const errors = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith('http://127.0.0.1:')) external.push(req.url()); });
  await page.getByRole('heading', { name: '把代码，变成看得懂的地图。' }).waitFor();
  await page.screenshot({ path: 'release/preview-home.png' });
  await page.locator('#settings-button').click();
  assert.equal(await page.locator('#provider').inputValue(), 'openai-compatible');
  await page.locator('#base-url').fill(modelBase);
  await page.locator('#load-models').click();
  await page.getByText('读取到 1 个模型', { exact: false }).waitFor();
  assert.equal(await page.locator('#model').inputValue(), 'local-test-model');
  await page.locator('#test-model').click();
  await page.getByText('连接成功：模型连接成功').waitFor();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await application.evaluate(({ dialog }, fixture) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] }); }, fixture);
  await page.locator('#choose').click();
  await page.locator('#project-path').filter({ hasText: fixture }).waitFor();
  await page.locator('#structural').click();
  await page.waitForFunction(() => document.querySelector('#graph-count').textContent.includes('4 节点'));
  await page.waitForFunction(() => !document.querySelector('#analyze').disabled);
  const frame = page.frameLocator('#viewer');
  await frame.getByText(path.basename(fixture), { exact: true }).first().waitFor({ timeout: 30000 });
  // Dismiss the original dashboard's optional onboarding overlay.
  await frame.getByRole('button', { name: /skip|跳过|不再显示/i }).click({ timeout: 2000 }).catch(() => {});
  await page.locator('#analyze').click();
  await page.waitForFunction(() => !document.querySelector('#analyze').disabled, { timeout: 30000 });
  assert.equal(modelCalls, 3, 'one connection test and two file analyses');
  await page.locator('#question').fill('项目入口在哪里？');
  await page.locator('#ask').click();
  await page.getByText('项目入口在 main.ts 中。', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#ask').disabled);
  await frame.getByText(path.basename(fixture), { exact: true }).first().waitFor({ timeout: 30000 });
  await frame.locator('.react-flow__node').first().waitFor({ timeout: 30000 });
  await frame.getByRole('button', { name: /skip|跳过|不再显示/i }).click({ timeout: 1000 }).catch(() => {});
  await frame.locator('aside').getByRole('button', { name: '文件', exact: true }).click();
  const sourceWait = page.waitForResponse(response => response.url().includes('/file-content.json') && response.url().includes('main.ts'));
  await frame.getByRole('button', { name: /main\.ts/ }).dblclick();
  await frame.getByText('main.ts', { exact: true }).first().waitFor();
  const sourceResponse = await sourceWait;
  assert.match((await sourceResponse.json()).content, /return helper/);
  await frame.locator('pre').filter({ hasText: 'return helper' }).first().waitFor();
  await page.screenshot({ path: 'release/preview-project.png' });
  const disk = JSON.parse(await fs.readFile(path.join(fixture, '.ua/knowledge-graph.json'), 'utf8'));
  assert.ok(disk.nodes.some(n => n.summary === '这是模型生成的测试摘要。'));
  assert.deepEqual(external, [], 'no renderer network requests leave the loopback interface');
  assert.deepEqual(errors, [], 'no renderer exceptions');
  const outbound = await application.evaluate(() => globalThis.modelRequestLog);
  assert.ok(outbound.length > 0);
  assert.ok(outbound.every(url => [modelBase + '/models', modelBase + '/chat/completions'].includes(url)), 'all main-process fetches target configured model endpoints');
  const blocked = await page.evaluate(async () => { try { await fetch('http://198.51.100.1/unrelated'); return false; } catch { return true; } });
  assert.equal(blocked, true, 'unrelated renderer network requests are blocked');
  await page.locator('#settings-button').click();
  await page.screenshot({ path: 'release/preview-settings.png' });
  console.log(JSON.stringify({ packaged, graphNodes: disk.nodes.length, modelCalls, rendererExternalRequests: external.length, modelEndpoint: modelBase, modelOnlyOutbound: true, unrelatedNetworkBlocked: blocked, rendererErrors: errors.length, result: 'PASS' }));
} finally {
  await application.close(); service.close();
  await fs.rm(fixture, { recursive: true, force: true });
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
