const $ = id => document.getElementById(id);
let current = null, busy = false, hasGraph = false;
async function call(name, ...args) {
  const result = await window.desktop.call(name, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function setBusy(value) {
  busy = value;
  for (const id of ['choose', 'recent', 'settings-button', 'connection', 'empty-choose']) $(id).disabled = value;
  $('structural').disabled = value || !current?.root;
  $('analyze').disabled = value || !current?.root;
  $('export').disabled = value || !hasGraph;
  $('ask').disabled = value || !hasGraph;
  $('cancel').hidden = !value;
}
function showProject(state) {
  current = state; hasGraph = !!state.graph;
  $('project-name').textContent = state.root?.split(/[\\/]/).pop() || '选择一个项目，开始探索';
  $('project-path').textContent = state.root || '支持本机代码库与文档目录';
  $('project-path').title = state.root || '';
  $('graph-count').textContent = hasGraph ? `${state.graph.nodes} 节点 · ${state.graph.edges} 关系` : '尚未分析';
  $('empty').hidden = hasGraph;
  $('viewer').hidden = !hasGraph;
  $('viewer').src = state.viewerUrl ? state.viewerUrl + '&v=' + Date.now() : 'about:blank';
  $('messages').replaceChildren();
  if (state.root && !hasGraph) message('已打开项目。点击“仅解析结构”可立即生成结构图；点击“模型分析”可增加中文摘要。');
  setBusy(busy);
}
function message(text, type = 'assistant') {
  const item = document.createElement('div'); item.className = 'message ' + type; item.textContent = text;
  $('messages').append(item); $('messages').scrollTop = $('messages').scrollHeight;
}
function fillSettings(settings) {
  $('provider').value = settings.provider; $('base-url').value = settings.baseUrl;
  $('model').value = settings.model; $('api-key').value = ''; $('clear-key').checked = false;
  $('file-limit').value = String(settings.maxFileChars);
  $('key-hint').textContent = settings.hasKey ? '密钥已加密保存。留空保留，勾选上方选项可清除。' : '如服务启用了认证，可在此填写。';
  $('model-label').textContent = settings.model || '未配置模型';
}
function settingsValue() { return { provider: $('provider').value, baseUrl: $('base-url').value.trim(), model: $('model').value.trim(), apiKey: $('api-key').value, clearKey: $('clear-key').checked, maxFileChars: Number($('file-limit').value) }; }
function settingsOpen() { if (busy) return; $('settings-status').textContent = ''; $('settings-dialog').showModal(); }
$('settings-button').onclick = settingsOpen; $('connection').onclick = settingsOpen;
$('close-settings').onclick = () => $('settings-dialog').close();
async function choose(name) {
  try { notice(); const state = await call(name); if (state) { showProject(state); $('status-text').textContent = state.graph ? '已打开本地图谱 · 可以探索或重新分析' : '项目已就绪 · 请选择分析方式'; } }
  catch (error) { notice(error.message); }
}
$('choose').onclick = () => choose('choose-project'); $('empty-choose').onclick = $('choose').onclick;
$('recent').onclick = () => choose('open-recent');
async function analyze(structural) {
  try { notice(); setBusy(true); $('progress').value = 0; await call('analyze', structural); }
  catch (error) { setBusy(false); notice(error.message); if (/模型/.test(error.message)) settingsOpen(); }
}
$('structural').onclick = () => analyze(true); $('analyze').onclick = () => analyze(false);
$('cancel').onclick = async () => { try { await call('cancel'); $('status-text').textContent = '正在取消任务…'; } catch (error) { notice(error.message); } };
$('export').onclick = async () => { try { if (await call('export')) notice('图谱已导出。'); } catch (error) { notice(error.message); } };
$('settings-form').onsubmit = async event => {
  event.preventDefault();
  try { const saved = await call('settings', settingsValue()); fillSettings(saved); $('settings-dialog').close(); notice('模型设置已保存。'); }
  catch (error) { $('settings-status').textContent = error.message; }
};
async function modelAction(action) {
  const button = $(action === 'models' ? 'load-models' : 'test-model'); button.disabled = true;
  $('settings-status').textContent = action === 'models' ? '正在读取模型…' : '正在等待模型回复，首次加载可能需要一些时间…';
  try {
    const result = await call(action, settingsValue());
    if (action === 'models') {
      $('model-list').replaceChildren(...result.map(id => { const option = document.createElement('option'); option.value = id; return option; }));
      if (!$('model').value && result.length) $('model').value = result[0];
      $('settings-status').textContent = result.length ? `读取到 ${result.length} 个模型，可在模型输入框中选择。` : '没有找到模型，请先下载模型。';
    } else $('settings-status').textContent = '连接成功：' + result;
  } catch (error) { $('settings-status').textContent = error.message; }
  finally { button.disabled = false; }
}
$('load-models').onclick = () => modelAction('models'); $('test-model').onclick = () => modelAction('test');
$('chat-form').onsubmit = async event => {
  event.preventDefault(); const question = $('question').value.trim(); if (!question || busy || !hasGraph) return;
  $('question').value = ''; message(question, 'user'); setBusy(true);
  $('status-text').textContent = '模型正在回答…';
  try { message(await call('chat', question)); $('status-text').textContent = '回答完成 · 基于图谱摘要'; }
  catch (error) { message(error.message, 'error'); $('status-text').textContent = '回答未完成'; }
  finally { setBusy(false); }
};
document.querySelectorAll('.suggestion').forEach(button => button.onclick = () => { $('question').value = button.dataset.question; $('question').focus(); });
window.desktop.on('progress', data => {
  $('status-text').textContent = `${data.stage}${data.file ? ' · ' + data.file : ''}${data.warning ? ' · ' + data.warning : ''}`;
  $('status-count').textContent = data.total ? `${data.completed} / ${data.total}${data.reused ? ' · 缓存 ' + data.reused : ''}${data.failed ? ' · 摘要失败 ' + data.failed : ''}` : '';
  $('progress').value = data.total ? data.completed / data.total * 100 : 0;
  if (data.stage === '分析完成' && (data.failed || data.skipped || data.truncated)) notice(`分析完成：${data.failed || 0} 个摘要失败，${data.skipped || 0} 项跳过，${data.truncated || 0} 个文件仅分析开头。详细记录在项目的 .ua/desktop-report.json（旧项目为 .understand-anything）。`);
});
window.desktop.on('completed', state => { showProject(state); $('progress').value = 100; });
window.desktop.on('task-error', data => { notice(data.message); $('status-text').textContent = '任务已停止'; });
window.desktop.on('idle', () => setBusy(false));
try { const state = await call('state'); fillSettings(state.settings); $('recent').disabled = !state.lastProject; }
catch (error) { notice(error.message); }
