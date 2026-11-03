import { app, BrowserWindow, ipcMain, dialog, safeStorage, session, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { validateSettings, listModels, complete } from './model.mjs';
import { analyzeProject, loadGraph, answerQuestion } from '../dist-desktop/engine.mjs';

// Model requests are the only outbound feature; Chromium renders bundled local assets.
for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-domain-reliability', 'dns-prefetch-disable', 'no-pings']) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,AutofillServerCommunication');

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let window, transport, root = null, graph = null, operation = null;
let saved = { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', model: '', apiKey: '', maxFileChars: 12000 };
let lastProject = null;
const configFile = () => path.join(app.getPath('userData'), 'settings.json');
const send = (type, data) => { if (window && !window.isDestroyed()) window.webContents.send(type, data); };
const describe = () => ({ root, graph: graph ? { name: graph.project.name, nodes: graph.nodes.length, edges: graph.edges.length, analyzedAt: graph.project.analyzedAt } : null,
  viewerUrl: graph ? `${transport.origin}/viewer/index.html?token=${transport.token}` : null });

async function saveConfig() {
  const { apiKey, ...publicSettings } = saved;
  if (apiKey && !safeStorage.isEncryptionAvailable()) throw new Error('Windows 密钥加密不可用，无法保存密钥。');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  const temp = configFile() + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ settings: publicSettings, encryptedKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : '', lastProject }, null, 2));
  await fs.rename(temp, configFile());
}

function handle(name, callback) {
  ipcMain.handle(name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== transport.origin) throw new Error('Unauthorized');
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败' }; }
  });
}

function requireIdle() { if (operation) throw new Error('请先等待当前任务完成或取消任务。'); }

app.whenReady().then(async () => {
Menu.setApplicationMenu(null);
try {
  const stored = JSON.parse(await fs.readFile(configFile(), 'utf8'));
  saved = validateSettings({ ...stored.settings, apiKey: stored.encryptedKey && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(stored.encryptedKey, 'base64')) : '' });
  lastProject = stored.lastProject;
} catch {}
transport = await startServer({ appRoot, getProject: () => ({ root, graph }) });
// All renderer traffic stays within the embedded local UI. Model calls run in the main process.
session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  const allowed = details.url.startsWith(transport.origin + '/') || /^(data:|blob:|devtools:)/.test(details.url);
  callback({ cancel: !allowed });
});
session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

handle('state', () => ({ settings: { ...saved, apiKey: '', hasKey: !!saved.apiKey }, lastProject, ...describe() }));
handle('settings', async (value) => {
  requireIdle();
  saved = validateSettings({ ...value, apiKey: value.clearKey ? '' : value.apiKey || saved.apiKey });
  await saveConfig();
  return { ...saved, apiKey: '', hasKey: !!saved.apiKey };
});
handle('models', async (value) => listModels(validateSettings({ ...value, apiKey: value.clearKey ? '' : value.apiKey || saved.apiKey })));
handle('test', async (value) => complete(validateSettings({ ...value, apiKey: value.clearKey ? '' : value.apiKey || saved.apiKey }), [{ role: 'user', content: '只回复：模型连接成功' }]));
handle('choose-project', async () => {
  requireIdle();
  const selected = await dialog.showOpenDialog(window, { title: '选择要理解的项目目录', properties: ['openDirectory'] });
  if (selected.canceled) return null;
  const selectedRoot = await fs.realpath(selected.filePaths[0]);
  const selectedGraph = await loadGraph(selectedRoot);
  root = selectedRoot; graph = selectedGraph; lastProject = root;
  await saveConfig();
  return describe();
});
handle('open-recent', async () => {
  requireIdle();
  if (!lastProject) throw new Error('没有最近项目。');
  const selectedRoot = await fs.realpath(lastProject);
  const selectedGraph = await loadGraph(selectedRoot);
  root = selectedRoot; graph = selectedGraph;
  return describe();
});
handle('analyze', async (structuralOnly) => {
  requireIdle();
  if (!root) throw new Error('请先选择项目。');
  if (!structuralOnly && !saved.model) throw new Error('请先设置并选择模型。');
  operation = new AbortController();
  const controller = operation;
  // Return immediately; long-running work reports progress through events.
  analyzeProject(root, saved, { structuralOnly: !!structuralOnly }, controller.signal, data => send('progress', data))
    .then(result => { graph = result; send('completed', describe()); })
    .catch(error => send('task-error', { message: controller.signal.aborted ? '任务已取消，原图谱保留。重新分析可复用已保存的缓存。' : error.message }))
    .finally(() => { operation = null; send('idle', null); });
  return true;
});
handle('cancel', () => { operation?.abort(new Error('任务已取消')); return true; });
handle('chat', async (question) => {
  requireIdle();
  if (!graph) throw new Error('请先生成或打开图谱。');
  if (typeof question !== 'string' || !question.trim() || question.length > 6000) throw new Error('请输入 1–6000 字的问题。');
  operation = new AbortController();
  try { return await answerQuestion(graph, question.trim(), saved, operation.signal); }
  finally { operation = null; send('idle', null); }
});
handle('export', async () => {
  if (!graph) throw new Error('尚无可导出的图谱。');
  const selected = await dialog.showSaveDialog(window, { defaultPath: `${graph.project.name}-knowledge-graph.json`, filters: [{ name: '知识图谱 JSON', extensions: ['json'] }] });
  if (selected.canceled) return false;
  await fs.writeFile(selected.filePath, JSON.stringify(graph, null, 2), 'utf8');
  return true;
});

window = new BrowserWindow({
  width: 1500, height: 980, minWidth: 1060, minHeight: 720,
  title: 'Understand Anything Desktop', backgroundColor: '#0d1015',
  webPreferences: { preload: path.join(appRoot, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false },
});
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.on('will-navigate', (event, url) => { if (url !== transport.origin + '/') event.preventDefault(); });
await window.loadURL(transport.origin + '/');
window.on('closed', () => { operation?.abort(new Error('窗口已关闭')); transport.server.close(); app.quit(); });
app.on('window-all-closed', () => app.quit());
}).catch(error => { dialog.showErrorBox('Understand Anything 启动失败', error.message); app.quit(); });
