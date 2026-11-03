export function validateSettings(value = {}) {
  const url = new URL(value.baseUrl || 'http://127.0.0.1:11434/v1');
  if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) {
    throw new Error('请填写 HTTP 或 HTTPS 服务地址；密钥请填入访问密钥字段。');
  }
  // Preserve compatibility with existing local service settings.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  url.pathname = url.pathname.replace(/\/+$/, '');
  if (!url.pathname || url.pathname === '/') url.pathname = '/v1';
  const model = String(value.model || '').trim();
  if (model.length > 200) throw new Error('模型名称不能超过 200 个字符。');
  return {
    provider: 'openai-compatible',
    baseUrl: url.href.replace(/\/$/, ''), model,
    apiKey: String(value.apiKey || '').slice(0, 4096),
    maxFileChars: Math.max(2000, Math.min(48000, Number(value.maxFileChars) || 12000)),
  };
}

async function request(settings, route, options = {}, signal, timeout = 180000) {
  const config = validateSettings(settings);
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  let response;
  try {
    response = await fetch(`${config.baseUrl}${route}`, {
      ...options, redirect: 'error', signal: combined,
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (combined.aborted) throw new Error('模型响应超时，请检查模型是否已加载或改用较小的模型。');
    throw new Error('无法连接模型。请启动 OpenAI Compatible 服务，并检查地址和端口。');
  }
  if (!response.ok) throw new Error(`模型返回 ${response.status}。请检查模型名称、服务状态和访问密钥。`);
  return response.json();
}

export async function listModels(settings, signal) {
  const data = await request(settings, '/models', {}, signal, 15000);
  if (!Array.isArray(data.data)) throw new Error('服务没有返回兼容的模型列表。');
  return data.data.map(item => item.id).filter(id => typeof id === 'string');
}

export async function complete(settings, messages, signal) {
  const config = validateSettings(settings);
  if (!config.model) throw new Error('请先选择模型。');
  const data = await request(config, '/chat/completions', {
    method: 'POST', body: JSON.stringify({ model: config.model, messages, stream: false, temperature: 0.15, max_tokens: 2048 }),
  }, signal);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型没有返回文本，请检查模型是否支持聊天。');
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
