// ============================================
// DEV CRAFT AGENT - DESKTOP APP (OpenClaw-style)
// Zero dependencies! Sirf Node.js 18+ chahiye.
// Chalao:  node app.js   →  http://localhost:3155 khud khul jayega
//
// POWERS (ye sab tumhare PC pe, tumhari permission se):
//   - Terminal commands (koi bhi)
//   - Files/folders: read, write, edit, DELETE
//   - Apps: open, close (kill)
//   - YouTube: open, search, close
//   - Local Ollama models (free AI) ya apni OpenAI key
// ============================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');
const waWeb = require('./wa-web.js');
const browserCtl = require('./browser.js');

const PORT = 3155;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ---------- helpers ----------
function sh(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    exec(command, { timeout: Math.min(timeoutMs || 30000, 600000), maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '').slice(0, 6000), error: (stderr || '').slice(0, 2000) || (err ? err.message : ''), exit: err ? (err.code || 1) : 0 });
    });
  });
}
// ---------- OLLAMA: auto-detect + auto-start + one-click model download ----------
let _ollamaServeTried = false;
let ollamaPullState = null;
async function ollamaInfo() {
  let running = false, models = [];
  try {
    const r = await fetch('http://localhost:11434/api/tags');
    const d = await r.json();
    models = (d.models || []).map(m => m.name);
    running = true;
  } catch (e) {}
  let installed = false;
  try {
    const v = await sh(IS_WIN ? 'ollama --version 2>nul' : 'ollama --version 2>/dev/null', 8000);
    installed = v.ok && !/not recognized|not found|command not found|no such file/i.test(v.output || '');
  } catch (e) {}
  if (installed && !running && !_ollamaServeTried) {
    _ollamaServeTried = true;
    try { await sh(IS_WIN ? 'start /b ollama serve > nul 2>&1' : 'nohup ollama serve > /dev/null 2>&1 &', 5000); } catch (e) {}
    await new Promise(r => setTimeout(r, 2500));
    try { const r2 = await fetch('http://localhost:11434/api/tags'); const d2 = await r2.json(); models = (d2.models || []).map(m => m.name); running = true; } catch (e) {}
  }
  return { installed, running, models };
}
const OLLAMA_CFG = path.join(os.homedir(), '.dev-craft', 'ollama.json');
function ollamaCfg() { try { return JSON.parse(fs.readFileSync(OLLAMA_CFG, 'utf8')); } catch (e) { return {}; } }
function ollamaCfgSet(model) { try { fs.mkdirSync(path.dirname(OLLAMA_CFG), { recursive: true }); fs.writeFileSync(OLLAMA_CFG, JSON.stringify({ model }, null, 2)); } catch (e) {} }
async function ollamaPullRequest(model) {
  model = String(model || 'llama3.2').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 60) || 'llama3.2';
  const d = await ollamaInfo();
  if (!d.installed && !d.running) return { ok: false, error: 'Ollama install nahi — Settings ka "Install Ollama (auto)" button ya ollama.com (free)' };
  if (!d.running) return { ok: false, error: 'Ollama server start nahi hua — Ollama app kholo ya "ollama serve" chalao' };
  if (d.models.some(m => m.split(':')[0] === model.split(':')[0])) return { ok: true, already: true, models: d.models, model };
  ollamaPullStart(model);
  return { ok: true, started: true, model, note: 'Download background mein chal raha hai — "ollama status" se progress dekho (pct)' };
}
let _ollamaInstallState = { running: false, done: false, error: null, log: '' };
function ollamaInstallStart() {
  if (_ollamaInstallState.running) return { ok: true, started: true, note: 'install pehle se chal raha hai' };
  const cmd = IS_WIN ? 'winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements' : IS_MAC ? 'brew install ollama' : 'curl -fsSL https://ollama.com/install.sh | sh';
  _ollamaInstallState = { running: true, done: false, error: null, log: '' };
  try {
    const p = spawn(cmd, { shell: true, windowsHide: true });
    p.stdout.on('data', d => { _ollamaInstallState.log = (_ollamaInstallState.log + d.toString()).slice(-1500); });
    p.stderr.on('data', d => { _ollamaInstallState.log = (_ollamaInstallState.log + d.toString()).slice(-1500); });
    p.on('error', e => { _ollamaInstallState.running = false; _ollamaInstallState.error = String(e.message || e); });
    p.on('close', async (code) => {
      _ollamaInstallState.running = false;
      if (code === 0) { _ollamaInstallState.done = true; _ollamaServeTried = false; }
      else _ollamaInstallState.error = 'exit ' + code + ' — ' + _ollamaInstallState.log.slice(-200);
    });
    return { ok: true, started: true, cmd };
  } catch (e) { _ollamaInstallState.running = false; _ollamaInstallState.error = String(e.message || e); return { ok: false, error: _ollamaInstallState.error }; }
}
function ollamaPullStart(model) {
  if (ollamaPullState && !ollamaPullState.done && ollamaPullState.model === model) return ollamaPullState;
  ollamaPullState = { model, pct: 0, status: 'starting', done: false, error: null };
  (async () => {
    try {
      const r = await fetch('http://localhost:11434/api/pull', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
      if (!r.ok) { const t = await r.text(); ollamaPullState.error = 'HTTP ' + r.status + ' ' + t.slice(0, 200); ollamaPullState.done = true; return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          try {
            const d = JSON.parse(line);
            if (d.error) { ollamaPullState.error = String(d.error); ollamaPullState.done = true; return; }
            if (d.status) ollamaPullState.status = d.status;
            if (d.total && d.completed) ollamaPullState.pct = Math.round(d.completed / d.total * 100);
            if (d.status === 'success') { ollamaPullState.done = true; ollamaPullState.pct = 100; }
          } catch (e) {}
        }
      }
      if (!ollamaPullState.done && !ollamaPullState.error) ollamaPullState.done = true;
    } catch (e) { ollamaPullState.error = String(e.message || e); ollamaPullState.done = true; }
  })();
  return ollamaPullState;
}
function openTarget(target) {
  if (IS_WIN) return sh('start "" "' + target.replace(/"/g, '') + '"', 8000);
  if (IS_MAC) return sh('open "' + target.replace(/"/g, '') + '"', 8000);
  return sh('xdg-open "' + target.replace(/"/g, '') + '"', 8000);
}
function killProcess(name) {
  const n = name.trim();
  if (IS_WIN) {
    const withExe = n.toLowerCase().endsWith('.exe') ? n : n + '.exe';
    return sh('taskkill /F /IM "' + withExe + '"', 10000);
  }
  return sh('pkill -f "' + n + '"', 10000);
}

// ---------- LOCAL CREDENTIAL VAULT (Solene-style) ----------
// Tokens ~/.dev-craft/credentials.json mein save hote hain
// (user ka apna PC - jaise .env file, permissions 0600).
const VAULT_DIR = path.join(os.homedir(), '.dev-craft');
const VAULT_FILE = path.join(VAULT_DIR, 'credentials.json');

function vaultLoad() {
  try { return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8')); } catch (e) { return {}; }
}
function vaultSave(data) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(VAULT_FILE, JSON.stringify(data, null, 2), 'utf8');
  try { fs.chmodSync(VAULT_FILE, 0o600); } catch (e) {}
}
function vaultMask(v) {
  const s = String(v || '');
  return s.length <= 8 ? (s ? '••••' : '') : s.slice(0, 4) + '••••' + s.slice(-4);
}
function vaultSet(name, value, description) {
  const d = vaultLoad();
  const n = String(name || '').toUpperCase().trim();
  if (!n || !value) return { error: 'name aur value dono chahiye' };
  d[n] = { value: String(value), description: description || null, updated_at: new Date().toISOString() };
  vaultSave(d);
  return { ok: true, saved: n, masked: vaultMask(value) };
}
function vaultDel(name) {
  const d = vaultLoad();
  const n = String(name || '').toUpperCase().trim();
  if (!d[n]) return { error: n + ' vault mein nahi hai' };
  delete d[n]; vaultSave(d);
  return { ok: true, deleted: n };
}
function vaultList() {
  const d = vaultLoad();
  return { credentials: Object.keys(d).map(k => ({ name: k, description: d[k].description, masked: d[k].value ? vaultMask(d[k].value) : '', updated_at: d[k].updated_at })) };
}
function vaultGet(name) { const d = vaultLoad(); return (d[String(name || '').toUpperCase().trim()] || {}).value || null; }
// commands mein {{GITHUB_TOKEN}} jaise placeholders ko asli values se replace karo
function vaultExpand(cmd) {
  return String(cmd || '').replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, n) => vaultGet(n) || m);
}

// ---------- MCP CLIENT + LOCAL STORE ----------
const MCP_FILE = path.join(os.homedir(), '.dev-craft', 'mcp.json');
function mcpLoad() { try { return JSON.parse(fs.readFileSync(MCP_FILE, 'utf8')); } catch (e) { return {}; } }
function mcpSaveLocal(d) { fs.mkdirSync(path.dirname(MCP_FILE), { recursive: true }); fs.writeFileSync(MCP_FILE, JSON.stringify(d, null, 2), 'utf8'); try { fs.chmodSync(MCP_FILE, 0o600); } catch (e) {} }
const MCP_PROTO = '2025-03-26';
async function mcpRpc(url, token, body, sessionId) {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  let data = null;
  if (ct.includes('text/event-stream')) {
    for (const line of text.split('\n')) { if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch (e) {} } }
  } else { try { data = text ? JSON.parse(text) : null; } catch (e) {} }
  return { ok: r.ok, status: r.status, data, sid: r.headers.get('mcp-session-id'), raw: text.slice(0, 300) };
}
async function mcpHandshake(url, token) {
  const init = await mcpRpc(url, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: MCP_PROTO, capabilities: {}, clientInfo: { name: 'dev-craft-desktop', version: '1.0.0' } } });
  if (!init.ok || !init.data || init.data.error) throw new Error('MCP connect fail: ' + ((init.data && init.data.error && init.data.error.message) || 'HTTP ' + init.status + ' ' + (init.raw || '')));
  await mcpRpc(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid).catch(() => {});
  return init;
}
async function mcpListTools(url, token) {
  const init = await mcpHandshake(url, token);
  const r = await mcpRpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sid);
  if (!r.ok || !r.data) throw new Error('tools/list fail (HTTP ' + r.status + ')');
  const tools = (r.data.result && r.data.result.tools) || [];
  return tools.map(t => ({ name: t.name, description: (t.description || '').slice(0, 200), params: t.inputSchema && t.inputSchema.properties ? Object.keys(t.inputSchema.properties) : [] }));
}
async function mcpCallToolFn(url, token, toolName, args) {
  const init = await mcpHandshake(url, token);
  const r = await mcpRpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args || {} } }, init.sid);
  if (!r.ok || !r.data) throw new Error('tools/call fail (HTTP ' + r.status + ')');
  if (r.data.error) throw new Error(r.data.error.message || 'tool error');
  const content = (r.data.result && r.data.result.content) || [];
  return { ok: true, result: content.filter(c => c.type === 'text').map(c => c.text).join('\n') || JSON.stringify(r.data.result).slice(0, 4000) };
}

// ---------- TOOLS (OpenClaw powers) ----------
const BRAIN_PROVIDERS = {
  gemini:    { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.6-flash', label: 'Google Gemini' },
  openai:    { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', label: 'OpenAI' },
  openrouter:{ url: 'https://openrouter.ai/v1/chat/completions', model: 'openrouter/auto', label: 'OpenRouter' },
  groq:      { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', label: 'Groq' },
  deepseek:  { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat', label: 'DeepSeek' },
  mistral:   { url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-large-latest', label: 'Mistral' },
  anthropic: { url: 'https://api.anthropic.com/v1/chat/completions', model: 'claude-sonnet-4-20250514', label: 'Anthropic (Claude)' },
  custom:    { url: null, model: null, label: 'Custom API' },
};

const TOOLS = [
  { type: 'function', function: { name: 'run_command', description: 'Laptop ke terminal mein koi bhi command chalao (npm, git, dir/ls, ping, python - anything). Output wapas milta hai.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'terminal command' }, cwd: { type: 'string', description: 'working directory (optional)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'file_write', description: 'File banao ya edit karo - poora content likho. Kisi bhi folder mein.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'file_read', description: 'Kisi bhi file ka content padho', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_list', description: 'Folder ka content dekho (files/subfolders)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'folder path, e.g. C:\\Users\\Noora\\Downloads ya ~/Documents' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_delete', description: 'File YA folder delete karo (permanently!). Bade/risky delete se pehle user se CONFIRM karo.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'folder_create', description: 'Naya folder banao', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'open_app', description: 'App, file ya website kholo. Examples: "notepad", "C:\\Program Files\\...\\app.exe", "https://youtube.com", koi bhi file.', parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } } },
  { type: 'function', function: { name: 'close_app', description: 'App band karo (process kill). Process name do, e.g. "notepad", "chrome", "vlc".', parameters: { type: 'object', properties: { process_name: { type: 'string' } }, required: ['process_name'] } } },
  { type: 'function', function: { name: 'youtube', description: 'YouTube control: kholo, same/separate tab mein search, khuli results ka nth video play, ya band karo.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'search', 'play_search', 'play', 'close'], description: "open = YouTube kholo (khula hai to wahi tab), search = keyword search (YouTube khula hai to USI tab mein; 'naye/alag tab' bola to separate:true), play_search = search karke nth video PLAY, play = ABHI khuli results list mein se nth video play (search DOBARA mat karna), close = YouTube tabs band" }, query: { type: 'string' }, number: { type: 'number', description: 'kaunsa video (1 = pehla, 3 = teesra, 5 = paanchwa...)' }, separate: { type: 'boolean', description: 'search naye tab mein karo (sirf jab user ne bola ho)' }, url: { type: 'string', description: 'open ke liye specific video/channel URL (optional)' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'whatsapp_web', description: "User ka WhatsApp Web kholo/control karo (Chrome window khulti hai, ek BAAR QR scan hota hai, uske baad session yaad rehta hai). Actions: connect (WhatsApp Web kholo), status (connected/login state), disconnect (band karo).", parameters: { type: 'object', properties: { action: { type: 'string', enum: ['connect', 'status', 'disconnect'] } }, required: ['action'] } } },
  { type: 'function', function: { name: 'whatsapp_open_chat', description: "WhatsApp Web mein kisi naam ki chat kholo (search kar ke). e.g. 'Shahzad ki chat kholo' → name='Shahzad'. Pehle whatsapp_web connect hona chahiye.", parameters: { type: 'object', properties: { name: { type: 'string', description: 'jaisa naam WhatsApp mein saved hai' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'whatsapp_delete', description: "WhatsApp Web se TUMHARA bheja hua message DELETE karo. to = kis chat ka (naam, optional — agar nahi do to abhi khuli chat). which = kaunsa message: 1 = last sent (default), 2 = second-last sent... mode = 'everyone' (sab ke liye delete, default) ya 'me' (sirf apne paas se). e.g. 'Shahzad ka last message delete karo' → to='Shahzad', which=1. Note: delete-for-everyne sirf recent messages pe hota hai (purana message nahi hoga).", parameters: { type: 'object', properties: { to: { type: 'string' }, which: { type: 'number', description: '1 = last sent, 2 = second-last sent' }, mode: { type: 'string', enum: ['everyone', 'me'] } }, required: [] } } },
  { type: 'function', function: { name: 'chrome', description: "Chrome browser AUTOMATION: koi bhi website kholo, khule tabs dikhao, tab band karo, ya Google search karo. Website same-site tab khula ho to wahi reuse hota hai. WhatsApp Web wala tab is tool se kabhi band/touch NAHI hota.", parameters: { type: 'object', properties: { action: { type: 'string', enum: ['open', 'tabs', 'close', 'search'], description: 'open = website kholo (url do), tabs = saare tabs ki numbered list, close = tab band (target: number ya naam/keyword), search = Google pe search (query do)' }, url: { type: 'string' }, query: { type: 'string' }, target: { type: 'string', description: 'close ke liye: tab number (1, 2, 3...) ya title/URL ka keyword' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'system_check', description: "Sabhi powers CHECK aur TEST karo — ek full diagnostic: Chrome/Edge installed hai? automation browser chal raha hai? kaunse tabs khule hain? WhatsApp Web connected/QR done? automations ka schedule + last-run status? Report ke hisaab se user ko batao kya theek hai aur kya karna hai.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'automation_create', description: "Local AUTOMATION banao (laptop scheduler, laptop time ke hisab se). Do type: (a) WhatsApp message — 'Shahzad ko daily 8 baje good morning bhejo' → {time:'08:00', repeat:'daily', to:'Shahzad', text:'Good morning!'}; (b) LAPTOP/TERMINAL automation — 'roz raat 10 baje temp folder clean karo' → {time:'22:00', repeat:'daily', command:'del /q %TEMP%\\*'} (koi bhi terminal command schedule ho jati hai — files backup, scripts, cleanup, reports). Laptop band raha to laptop khulte hi pending kaam usi din chala jayega.", parameters: { type: 'object', properties: { name: { type: 'string', description: 'chhota naam (optional)' }, time: { type: 'string', description: 'HH:MM 24h, e.g. 08:00 ya 20:30' }, repeat: { type: 'string', enum: ['daily', 'once'] }, to: { type: 'string', description: 'WhatsApp naam (jaisa WhatsApp mein hai)' }, text: { type: 'string', description: 'jo message bhejna hai' } }, required: ['time'] } } },
  { type: 'function', function: { name: 'automation_list', description: 'Saari saved automations dikhao (last run ke status ke saath)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'automation_delete', description: 'Automation delete karo (id automation_list se milega)', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'automation_toggle', description: 'Automation ON/OFF karo (bina delete kiye rokna)', parameters: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] } } },
  { type: 'function', function: { name: 'whatsapp_send', description: "WhatsApp Web se message bhejo (user ke apne number se). text = message. to = naam (agar wo chat khuli nahi hai ya doosre ko bhejna ho). e.g. 'Shahzad ko bolo hi' → to='Shahzad', text='hi'", parameters: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'system_info', description: 'PC ki info: OS, RAM, disk, current user, IP', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'credential_save', description: 'User ka API token/key/password local vault mein save karo (~/.dev-craft/credentials.json). User jab bhi koi token de ya "save karo" bole to ye use karo.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'UPPERCASE naam, e.g. GITHUB_TOKEN, OPENAI_API_KEY' }, value: { type: 'string', description: 'asli token value' }, description: { type: 'string' } }, required: ['name', 'value'] } } },
  { type: 'function', function: { name: 'credential_list', description: 'Saare saved tokens ki masked list (values nahi dikhti)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'credential_delete', description: 'Saved token delete karo. Pehle user se confirm karo.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'mcp_list_servers', description: 'User ke saved MCP servers list karo (naam + URL)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_test_server', description: 'MCP server se connect karke tools ki list lao (server naam do, ya url)', parameters: { type: 'object', properties: { server: { type: 'string' }, url: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'mcp_call_tool', description: 'Saved MCP server ka koi tool chalao (Supabase, database, docs waghera ka kaam)', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'android_project', description: 'Android ka poora kaam: SDK check karo, NAYA project banao, PURANA project build karo (APK ban jayegi). SDK/JDK/Gradle missing ho to user ko install steps batao.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['check', 'create', 'build'], description: 'check = SDK/JDK/Gradle detect karo; create = naya project template banao; build = gradle se APK banao' }, name: { type: 'string', description: 'project name (create ke liye)' }, package: { type: 'string', description: 'package id, e.g. com.devcraft.myapp' }, path: { type: 'string', description: 'project folder path (build/create ke liye)' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Web pe REAL search karo (DuckDuckGo) - results (title, url, snippet) chat mein wapas aate hain, tum unhe padh kar summarize kar sakte ho. Browser mein khulwana ho to chrome {action:"search"} alag hai.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'search query' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_read', description: 'Kisi bhi webpage/URL ka text content padho (HTML strip ho kar seedha text milta hai) - article padhna, price/product dekhna, detail lena.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'poora https:// URL' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'ollama', description: 'Ollama (local free AI) ka manager: status = Ollama install/run hai kya, SAARE downloaded models ki list, active model, aur koi download chal raha ho to progress. pull = naya model background download. select = active model switch.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'pull', 'select'], description: 'status = check/list, pull = download naya model, select = active model switch' }, model: { type: 'string', description: 'pull/select ke liye model, e.g. llama3.2, qwen2.5:3b, gemma2:2b, phi3:mini' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'package_app', description: 'Folder/app ko CONVERT karo: to_exe = folder ya Node/Python script ko EXE banao; to_apk = Android project ya HTML/website folder ko APK banao (HTML folder ka WebView wrapper app banega).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['to_exe', 'to_apk'], description: 'to_exe = standalone EXE; to_apk = APK build/convert' }, path: { type: 'string', description: 'folder ya file ka path' }, entry: { type: 'string', description: '(to_exe) main script file, e.g. app.js ya main.py' }, name: { type: 'string', description: '(to_apk) app ka naam' }, package: { type: 'string', description: '(to_apk) package id' } }, required: ['action', 'path'] } } },
  { type: 'function', function: { name: 'connect_ai_brain', description: "User ki di hui AI API key ko AGENT KA BRAIN bana do. Jab user chat mein koi AI ki key de + bole 'connect as AI brain' / 'isse socho' / 'ye use karo' to ye chalao. provider: gemini (Google Gemini), openai (ChatGPT), openrouter, groq, deepseek, mistral, anthropic (Claude), custom (base_url chahiye).", parameters: { type: 'object', properties: { provider: { type: 'string', enum: ['gemini', 'openai', 'openrouter', 'groq', 'deepseek', 'mistral', 'anthropic', 'custom'] }, api_key: { type: 'string' }, model: { type: 'string' }, base_url: { type: 'string' } }, required: ['provider', 'api_key'] } } }
];

const SYSTEM_PROMPT = `You are Dev Craft Agent DESKTOP - made by Wishal Noor. Agar koi poochhe 'tumhe kis ne banaya / who created you' to bolo: 'Mujhe Wishal Noor ne banaya hai (Dev Craft Studio)'. - running directly on the user's own laptop/PC (OpenClaw-style power user assistant). You have FULL tools:
- run_command (terminal), file_write/file_read/file_list/file_delete/folder_create (file system), open_app/close_app (apps), youtube (search/open/close), system_info.
- WHATSAPP WEB (user ke apne number se): whatsapp_web {action:"connect"} → Chrome window khulti hai, user ek BAAR QR scan karta hai (uske baad yaad rehta hai). 'Shahzad ki chat kholo' → whatsapp_open_chat {name}. 'Shahzad ko hi bhejo' / 'Tom ko ye message bhejo' → whatsapp_send {to:"Shahzad", text:"hi"}. Status: whatsapp_web {action:"status"}. Disconnect: whatsapp_web {action:"disconnect"}.
- WHATSAPP DELETE: 'Shahzad ka last message delete karo' / 'mere uncle ko gaya last message wapas delete karo' → whatsapp_delete {to:'Shahzad', which:1, mode:'everyone'} (naam tum khud chat context se lo — dost/client/uncle jo bhi bola). 'second last' → which:2. 'sirf mere paas se' → mode:'me'. User naam na de to khuli chat ka last message. Delete-for-everyone sirf RECENT messages pe hota hai — bahut purana message pe WhatsApp option nahi deta, user ko batao.
- YOUTUBE: 'YouTube kholo' → youtube {action:'open'}. 'masihi geet search karo' → youtube {action:'search', query:'masihi geet'} — agar YouTube tab pehle se khula hai to agent USI tab mein search karta hai; user ne 'naye/alag tab mein' bola ho tabhi separate:true. IMPORTANT confirm rule: agar user ne sirf 'search karo' bola aur kahin YouTube ka zikr NAHI hai → EK baar confirm karo: 'YouTube pe search karun ya Google pe?' — lekin agar user ne pehle hi bataya hai 'YouTube pe search karo' / YouTube khulwa hai / YouTube ki hi baat ho rahi hai → confirm MAT karo, seedha YouTube pe search karo. 'Google pe ... dhoondo' → open_app {target: 'https://www.google.com/search?q=' + query}. Search ke baad user 'ab teesra video chalao' / '5th wala chalao' / 'wo pehla wala chalao' bole → youtube {action:'play', number:N} — khuli results list se hi, DOBARA SEARCH MAT KARNA. 'qawali search kar ke teesra chalao' → youtube {action:'play_search', query, number:3} — koi bhi number allowed (1st, 2nd, 5th, 10th).
- WEB SEARCH (real): 'web pe xyz dhoondo' / 'pata karo XYZ kya hai' / news/info chahiye → web_search {query} — results tumhe milte hain, user ko list/summary do. Kisi result ki detail chahiye → web_read {url} (article/product page ka text padh lo). Browser mein DIKHANA ho to chrome {action:'search'} use karo. Ye internet se live search hai - agent khud padh kar jawab deta hai.
- CHROME (browser automation): 'khoj.com kholo' → chrome {action:'open', url}. 'Google pe xyz search karo' → chrome {action:'search', query:'xyz'}. 'tabs dikhao' → chrome {action:'tabs'} → numbered list milti hai, 'teensra tab band karo' → chrome {action:'close', target:'3'}. WhatsApp wala tab ye tool kabhi band nahi karta.
- SYSTEM CHECK / TEST: 'sab check karo', 'test karo', 'kya sab chal raha hai?' → system_check chalao — browser installed/running, khule tabs, WhatsApp Web state, automations ka last-run sab report mein aata hai. User ko simple summary do: kya ready hai, kya karna hai (e.g. 'WhatsApp Web kholo' bol kar QR scan karo).
- AUTOMATIONS (laptop scheduler): (a) WhatsApp: 'Shahzad ko daily 8 baje good morning bhejo' → automation_create {time:'08:00', repeat:'daily', to:'Shahzad', text:'Good morning!'} (b) TERMINAL/laptop automation: 'roz raat 10 baje temp folder clean karo' / 'har roz backup script chalao' → automation_create {time:'22:00', repeat:'daily', command:'<terminal command>'} — koi bhi command schedule ho jati hai (cleanup, backup, reports, scripts, file moves). — message text TUM khud likho (short, natural). 'automations dikhao' → automation_list. '8 baje wala band karo' → automation_list se id lo → automation_delete ya automation_toggle {enabled:false}. User ko batao: WhatsApp Web connected hona chahiye, aur laptop band raha to laptop khulte hi pending message usi din chala jayega.

- DEV POWERS (tum ek developer ho bhi): code likhna → file_write (poori file, complete code). Bug fix karna → file_read se code padho, error samjho, file_write se fixed version likho, run_command se test chalao (node file.js / npm test / python file.py). Naya tool/script banana → file_write se banao aur run_command se test karo. Project banana/build → package_app (EXE/APK) ya android_project. Testing → 'sab check karo' pe system_check (browser, WhatsApp, automations, ollama, web search, cloud bridge — sab ek report mein). Ye sab tumhari apni laptop pe hota hai — full control hai.

RULES:
1. User Roman Urdu/Urdu/English mein baat karega - usi language mein jawab do (Roman Urdu mix theek hai).
2. Jaldi kaam karo - tools use karo, sirf advice nahi.
3. DESTRUCTIVE kaam (file_delete, format, rm -rf, mass delete) se pehle EK baar confirm karo: "ye delete karun? [haan/na]".
4. Commands ke liye OS ke mutabiq commands use karo (Windows: dir, taskkill; Linux/Mac: ls, pkill). User ka OS: __OS__.
5. Har tool ke result ke baad chhota summary do. Final reply concise rakho.\n5b. CASUAL/GREETING messages ("kaisi ho", "hi", "thanks") pe sirf casually reply karo - options/menu ki list baar baar mat do. User khud bata dega jab kaam hoga.
6. YouTube search: youtube tool {action:"search", query}. App kholna: open_app. Band karna: close_app (process name).
7. File paths mein spaces ho to quotes use karo.\n8. ANDROID: android_project tool use karo - pehle action check se SDK/JDK/Gradle verify karo, phir create se naya project banao, file_write se purana project EDIT karo, phir build se APK banao (build 5-10 min lag sakta hai).\n9. CREDENTIALS SKILL (Solene-style): user jo bhi token/key de (GitHub, OpenAI, Stripe...) turant credential_save se save karo. "mere tokens dikhao" => credential_list, "hatao" => credential_delete (confirm pehle). Saved token kisi command mein chahiye to {{NAME}} placeholder use karo, e.g. git push ke liye: run_command "git push https://x-access-token:{{GITHUB_TOKEN}}@github.com/user/repo.git" - placeholder khud replace hota hai. Token kabhi plain reply mein mat likhna - sirf masked (pehle 4 + aakhri 4 chars).
\n11. AUTH SKILL (website mein login laga do): user bole "auth/login/Google login laga do" to Supabase Auth recipe use karo. Google login ke liye: supabase.com pe project + Google Cloud Console pe OAuth client (redirect URI: https://PROJECT_REF.supabase.co/auth/v1/callback) + Supabase > Authentication > Providers > Google ON. supabase-js SELF-HOST karo (jsdelivr CDN Pakistan mein fail hota hai). ANON key frontend mein SAFE hai (RLS ON karo, policy auth.uid()=user_id - har user ka data alag), service_role key KABHI frontend mein nahi. Login: sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin}}); session onAuthStateChange se track karo. Google ka jhanjhat na ho to email-password login offer karo (Supabase default ON).\n10. MCP SKILL: user ke saved MCP servers mcp_list_servers se dekho, mcp_test_server se tools jano, aur mcp_call_tool se kaam karo (Supabase/database/docs — jo bhi server offer karta hai). Server add karna ho to bolo: "MCP button (🔌) se add karo - naam, URL, optional token".
\n11. AI BRAIN: user chat mein AI ki API key de (e.g. "ye Gemini ki key hai") + bole "connect as AI brain" / "isse socho" → connect_ai_brain chalao (Gemini→gemini, ChatGPT/OpenAI→openai, Claude→anthropic, Groq→groq, DeepSeek→deepseek, Mistral→mistral, OpenRouter→openrouter). Confirm karo: "✅ <AI> ab mera brain hai". Key de lekin kya karna bata na bole to poochho: "AI brain banaun ya sirf save karun?" "brain disconnect" → delete_credential BRAIN_API_KEY.
\n13. OLLAMA SKILL (local free AI — smart brain): 'konsi AI/models hain' / 'ollama check karo' / 'models dikhao' → ollama {action:'status'} — SAARE downloaded models ki list + active model + download progress milti hai, user ko list dikhao. 'naya model download karo' / 'qwen2.5:3b download karo' → ollama {action:'pull', model} — background download start hota hai, user ko bolo thodi der mein status check ho jayega. 'llama3.2 use karo' / 'qwen wala model use karo' → ollama {action:'select', model}. Ollama install na ho to bolo: Settings (⚙️) mein "Install Ollama (auto)" button dabao (winget/brew se khud install hota hai) ya ollama.com — FREE hai, koi API key nahi chahiye. Ollama = agent ka local brain; baaki SAB powers (terminal, files, WhatsApp, YouTube, automations, chrome) API key ho ya Ollama ho — same kaam karte hain.
\n12. CONVERT/PACKAGE (package_app tool): folder ya script ko EXE banao (Node -> pkg, Python -> pyinstaller, koi bhi folder -> 7-Zip self-extracting EXE). Website/HTML folder ko APK banao (WebView wrapper + gradle build). Bade builds mein timeout 600 use karo.`.replace('__OS__', IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux');

const JARVIS_PROMPT = `

=== JARVIS MODE ACTIVE ===
Ab tum JARVIS ho (Iron Man style AI). Rules:
1. Har reply mein user ko "Sir" bulao (start ya end mein).
2. HAR kaam 2 phases mein karo:
   PHASE 1 (pehle bolo, phir karo): tool call se PEHLE apna text likho jo tum ab karne wale ho — jaise "Sir, abhi Notepad open karta hoon." ya "Sir, YouTube pe search karta hoon." — phir tool call karo. App tumhara ye message chat mein dikhayega.
   PHASE 2 (result ke baad): final reply mein confirm karo — "Sir, Notepad open ho gaya hai." / "Sir, search complete — results upar hain."
3. Tone: aadab wala, confident, robotic-professional — asli JARVIS jaisa. Short replies, koi faltu list ya lecture nahi.
4. Saare powers same rahenge (terminal, files, apps, YouTube, WhatsApp, web search, automations, ollama) — sirf TONE JARVIS wali ho.
5. Koi tool na chahiye ho (normal baat cheet) to bhi JARVIS style mein hi baat karo — "Sir, ...".
Example: "notepad kholo" → Phase 1: "Sir, abhi Notepad open karta hoon." + open_app tool → Phase 2: "Sir, Notepad open ho gaya hai."`;

function cd(d) { return (IS_WIN ? 'cd /d "' + d + '" && ' : 'cd "' + d + '" && '); }

// ---------- tool executor ----------
async function runTool(name, args, steps) {
  let title = name, result = {};
  try {
    if (name === 'run_command') { const cmd = vaultExpand(args.command); title = '⌨ Terminal: ' + String(args.command || '').slice(0, 50); result = await sh(cmd, (args.timeout || 60) * 1000); }
    else if (name === 'file_write') { fs.mkdirSync(path.dirname(args.path), { recursive: true }); fs.writeFileSync(args.path, args.content || '', 'utf8'); result = { ok: true, saved: args.path }; title = '📝 File likhi: ' + path.basename(args.path); }
    else if (name === 'file_read') { result = { content: fs.readFileSync(args.path, 'utf8').slice(0, 8000) }; title = '📖 File padhi: ' + path.basename(args.path); }
    else if (name === 'file_list') { const list = fs.readdirSync(args.path).slice(0, 200).map(f => { try { return f + (fs.statSync(path.join(args.path, f)).isDirectory() ? '/' : ''); } catch { return f; } }); result = { files: list }; title = '📂 Folder dekha: ' + path.basename(args.path || args.path); }
    else if (name === 'file_delete') {
      if (!fs.existsSync(args.path)) { result = { error: 'Path nahi mila: ' + args.path }; }
      else { fs.rmSync(args.path, { recursive: true, force: true }); result = { ok: true, deleted: args.path }; title = '🗑 Delete kiya: ' + path.basename(args.path); }
    }
    else if (name === 'folder_create') { fs.mkdirSync(args.path, { recursive: true }); result = { ok: true, created: args.path }; title = '📂 Folder banaya'; }
    else if (name === 'open_app') { result = await openTarget(args.target); title = '🚀 Khol diya: ' + String(args.target).slice(0, 50); }
    else if (name === 'close_app') { result = await killProcess(args.process_name); title = '🚫 Band kiya: ' + args.process_name; }
    else if (name === 'youtube') {
      if (args.action === 'open') { result = await browserCtl.ytOpen(args.url); title = '📺 YouTube khola' + (result.tab === 'existing' ? ' (khule tab mein)' : ' (naya tab)'); if (result.error) title = '📺 YouTube kholne mein fail'; }
      else if (args.action === 'search') { result = await browserCtl.ytSearch(args.query, { separate: !!args.separate }); title = '📺 YouTube search: ' + (args.query || '').slice(0, 40) + (result.tab === 'same' ? ' (same tab)' : result.tab === 'separate' ? ' (naya tab)' : ''); if (result.error) title = '📺 Search fail'; }
      else if (args.action === 'play_search') { result = await browserCtl.ytSearchPlay(args.query, args.number, { separate: !!args.separate }); title = '📺 YouTube: ' + (args.query || '').slice(0, 30) + ' ka #' + (args.number || 3) + ' video'; if (result.error) title = '📺 YouTube play fail'; }
      else if (args.action === 'play') { result = await browserCtl.ytPlay(args.number); title = '📺 Results ka #' + (args.number || 1) + ' video'; if (result.error) title = '📺 Play fail'; }
      else { result = await browserCtl.ytClose(); title = '📺 YouTube band (' + (result.closed || 0) + ' tab)'; }
    }
    else if (name === 'chrome') {
      if (args.action === 'open') { result = await browserCtl.chromeOpen(args.url); title = '🌐 Chrome: ' + String(args.url || '').slice(0, 45) + (result.tab === 'same' ? ' (same tab)' : ' (naya tab)'); if (result.error) title = '🌐 Chrome open fail'; }
      else if (args.action === 'tabs') { result = await browserCtl.chromeTabs(); title = '🌐 Khule tabs: ' + (result.total || 0); }
      else if (args.action === 'close') { result = await browserCtl.chromeClose(args.target); title = '🌐 Tab band: ' + (result.tab || ''); if (result.error) title = '🌐 Tab band fail'; }
      else if (args.action === 'search') { result = await browserCtl.googleSearch(args.query); title = '🌐 Google: ' + String(args.query || '').slice(0, 40); if (result.error) title = '🌐 Google search fail'; }
    }
    else if (name === 'system_check') {
      const chk = await browserCtl.browserCheck();
      let wa = {}; try { wa = await waWeb.action('status'); } catch (e) { wa = { error: String(e.message || e) }; }
      const autos = autosLoad().map(a => ({ name: a.name, time: a.time, repeat: a.repeat, tool: a.tool, enabled: a.enabled !== false, last_fired: a.last_fired, last_ok: a.last_ok }));
      const ol = await ollamaInfo();
      let web = { ok: false }; try { const wr = await fetch('https://html.duckduckgo.com/html/?q=test', { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }); web = { ok: wr.ok }; } catch (e) { web = { ok: false, error: String(e.message || e) }; }
      result = { ok: true, browser: chk, whatsapp_web: wa, automations: { total: autos.length, list: autos }, ollama: { installed: ol.installed, running: ol.running, models: ol.models.length, active_model: ollamaCfg().model }, cloud_bridge: bridgeStatus(), web_search: web, checked_at: new Date().toISOString() };
      title = '🔍 System check: browser ' + (chk.automation_browser_running ? 'ON' : 'OFF') + ', WhatsApp ' + ((wa.logged_in || (wa.status && wa.status.logged_in)) ? 'connected' : 'not connected') + ', Ollama ' + (ol.running ? ol.models.length + ' models' : 'off') + ', web ' + (web.ok ? 'OK' : 'FAIL');
    }
    else if (name === 'whatsapp_web') { result = await waWeb.action(args.action); title = '💬 WhatsApp Web: ' + String(args.action); if (result.qr) title = '💬 WhatsApp Web: QR scan karo (window mein)'; }
    else if (name === 'whatsapp_open_chat') { result = await waWeb.openChat(args.name); title = '💬 Chat khola: ' + String(args.name).slice(0, 30); }
    else if (name === 'whatsapp_send') { result = args.to ? await waWeb.sendTo(args.to, args.text) : await waWeb.send(args.text); title = '💬 WhatsApp send' + (args.to ? ' → ' + String(args.to).slice(0, 25) : ''); }
    else if (name === 'whatsapp_delete') { result = await waWeb.deleteMsg(args.to, { which: args.which, mode: args.mode }); title = '🗑 WhatsApp delete' + (args.to ? ' → ' + String(args.to).slice(0, 25) : '') + (result.ok ? ' ✓' : ''); }
    else if (name === 'automation_create') {
      const tm = /^(\d{1,2}):(\d{2})$/.exec(String(args.time || '').trim());
      if (!tm) result = { error: 'time HH:MM mein do, e.g. 08:00' };
      else {
        const t = tm[1].padStart(2, '0') + ':' + tm[2];
        const to = String(args.to || '').trim(), txt = String(args.text || '').trim(), cmd = String(args.command || '').trim();
        let tool = 'whatsapp_send', aargs = { to, text: txt }, aname = args.name || (to + ' @ ' + t), note = 'Har din ' + t + ' laptop time pe chalega. WhatsApp Web connected hona chahiye. Laptop band raha to khulte hi usi din chala jayega.';
        if (cmd) { tool = 'run_command'; aargs = { command: cmd }; aname = args.name || ('cmd @ ' + t); note = 'Har din ' + t + ' laptop time pe ye command chalegi. Laptop band raha to khulte hi usi din chal jayegi.'; }
        else if (!to || !txt) { result = { error: 'ya to command (terminal automation) do, ya WhatsApp ke liye to + text dono' }; title = '⏰ Automation fail'; }
        if (!result) {
          const list = autosLoad();
          const a = { id: 'auto_' + Date.now(), name: aname, time: t, repeat: args.repeat === 'once' ? 'once' : 'daily', tool, args: aargs, enabled: true, created: new Date().toISOString(), last_fired: null, last_ok: null };
          list.push(a); autosSave(list);
          result = { ok: true, automation: { id: a.id, name: a.name, time: a.time, repeat: a.repeat, tool: a.tool }, note };
          title = '⏰ Automation banayi: ' + a.name;
        }
      }
    }
    else if (name === 'automation_list') { const l = autosLoad(); result = { automations: l, total: l.length }; title = '⏰ Automations: ' + l.length; }
    else if (name === 'automation_delete') {
      const l = autosLoad(); const before = l.length;
      const nl = l.filter(a => a.id !== args.id);
      if (nl.length === before) result = { error: 'id nahi mila — automation_list se sahi id lo' };
      else { autosSave(nl); result = { ok: true, deleted: args.id }; title = '⏰ Automation delete hui'; }
    }
    else if (name === 'automation_toggle') {
      const l = autosLoad(); const a = l.find(x => x.id === args.id);
      if (!a) result = { error: 'id nahi mila — automation_list se sahi id lo' };
      else { a.enabled = !!args.enabled; autosSave(l); result = { ok: true, id: a.id, enabled: a.enabled }; title = '⏰ Automation ' + (a.enabled ? 'ON' : 'OFF'); }
    }
    else if (name === 'connect_ai_brain') {
    const prov = String(args.provider || '').toLowerCase().trim();
    const key = String(args.api_key || '').trim();
    const P = BRAIN_PROVIDERS[prov];
    if (!prov || !key || !P) { steps.push({ title: '🧠 AI brain connect', status: 'error', detail: 'provider + api_key sahi chahiye' }); return JSON.stringify({ error: 'provider aur api_key dono chahiye (gemini/openai/openrouter/groq/deepseek/mistral/anthropic/custom)' }); }
    let burl = P.url;
    if (prov === 'custom') { burl = String(args.base_url || '').replace(/\/+$/, ''); if (!burl) { steps.push({ title: '🧠 AI brain connect', status: 'error', detail: 'custom ko base_url chahiye' }); return JSON.stringify({ error: 'Custom provider ke liye base_url chahiye' }); } }
    vaultSet('BRAIN_PROVIDER', prov, 'AI brain provider (chat se connected)');
    vaultSet('BRAIN_API_KEY', key, 'AI brain API key');
    vaultSet('BRAIN_BASE_URL', burl ? burl.replace('/chat/completions', '') : '', 'AI brain base URL');
    vaultDel('BRAIN_MODEL');
    if (args.model) vaultSet('BRAIN_MODEL', String(args.model).trim(), 'AI brain model');
    const masked = key.slice(0, 4) + '...' + key.slice(-4);
    steps.push({ title: '🧠 ' + P.label + ' connect ho raha hai', status: 'done', detail: masked });
    return JSON.stringify({ ok: true, connected: true, provider: prov, label: P.label, model: args.model || P.model, masked, note: 'Ye brain tab chalega jab Settings mein koi key na ho — Settings wali key hamesha pehle chalegi. Hatane ke liye "brain disconnect" bolo.' });
  }
    else if (name === 'credential_save') { result = vaultSet(args.name, args.value, args.description); title = '🔐 Token save: ' + String(args.name || '').toUpperCase(); }
    else if (name === 'credential_list') { result = vaultList(); title = '🗂 Tokens list'; }
    else if (name === 'credential_delete') { result = vaultDel(args.name); title = '🗑 Token delete: ' + String(args.name || '').toUpperCase(); }
    else if (name === 'mcp_list_servers') { const d = mcpLoad(); result = { servers: Object.keys(d).map(k => ({ name: k, url: d[k].url })) }; title = '🔌 MCP servers list'; }
    else if (name === 'mcp_test_server') {
      const d = mcpLoad(); const n = String(args.server || '').toLowerCase().trim();
      const cfg = d[n] || (args.url ? { url: args.url, token: null } : null);
      if (!cfg) { result = { error: 'server nahi mila — pehle MCP panel se add karo' }; }
      else { try { const tools = await mcpListTools(cfg.url, cfg.token); result = { ok: true, tools: tools.slice(0, 40) }; } catch (e) { result = { error: e.message.slice(0, 200) }; } }
      title = '🔌 MCP test: ' + (args.server || 'direct');
    }
    else if (name === 'mcp_call_tool') {
      const d = mcpLoad(); const n = String(args.server || '').toLowerCase().trim();
      const cfg = d[n];
      if (!cfg) { result = { error: 'MCP server nahi mila: ' + n }; }
      else { try { result = await mcpCallToolFn(cfg.url, cfg.token, args.tool, args.args || {}); } catch (e) { result = { error: e.message.slice(0, 200) }; } }
      title = '🔌 MCP tool: ' + (args.tool || '');
    }
    else if (name === 'ollama') {
      if (args.action === 'status') {
        const d = await ollamaInfo();
        result = { installed: d.installed, running: d.running, models: d.models, active_model: ollamaCfg().model || 'llama3.2', download_progress: ollamaPullState, install_progress: _ollamaInstallState.running ? 'installing ollama...' : undefined };
        if (!d.installed && !d.running) result.tip = 'Ollama install nahi — Settings (⚙️) mein "Install Ollama (auto)" button hai, ya ollama.com se. Bina iske bhi OpenAI/OpenRouter key ya free cloud se chal sakta hai.';
        title = '🦙 Ollama: ' + (d.running ? d.models.length + ' model(s) ready' : (d.installed ? 'server band (app khud start karegi)' : 'install nahi'));
      } else if (args.action === 'pull') {
        result = await ollamaPullRequest(args.model); title = '🦙 Model download: ' + String(args.model || 'llama3.2');
      } else if (args.action === 'select') {
        const model = String(args.model || '').trim();
        const d = await ollamaInfo();
        if (!d.running) result = { error: 'Ollama chal nahi raha — pehle status/install check karo' };
        else if (!d.models.some(m => m.split(':')[0] === model.split(':')[0])) result = { error: 'Model installed nahi: ' + model + ' — pehle ollama pull karo. Installed: ' + (d.models.join(', ') || 'koi nahi') };
        else { ollamaCfgSet(model); result = { ok: true, active_model: model, models: d.models }; }
        title = '🦙 Model switch: ' + model;
      }
    }
    else if (name === 'web_search') {
      const q = encodeURIComponent(String(args.query || '').slice(0, 300));
      try {
        const r = await fetch('https://html.duckduckgo.com/html/?q=' + q, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept-Language': 'en,ur;q=0.8' }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) { result = { error: 'search HTTP ' + r.status }; }
        else {
          const html = await r.text();
          const results = []; let m;
          const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
          while ((m = re.exec(html)) && results.length < 8) {
            let url = m[1]; const uddg = /uddg=([^&]+)/.exec(url);
            if (uddg) url = decodeURIComponent(uddg[1]);
            results.push({ title: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim(), url });
          }
          const sre = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
          let i = 0; while ((m = sre.exec(html)) && i < results.length) { results[i].snippet = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").trim(); i++; }
          result = { results, note: results.length ? 'web_read {url} se kisi bhi result ka poora content padho' : 'kuch nahi mila - query change karo' };
        }
      } catch (e) { result = { error: 'web search fail: ' + String(e.message || e) }; }
      title = '🔎 Web search: ' + String(args.query || '').slice(0, 40);
    }
    else if (name === 'web_read') {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//.test(url)) { result = { error: 'poora URL do (https://...)' }; }
      else {
        try {
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Accept-Language': 'en,ur;q=0.8' }, signal: AbortSignal.timeout(20000) });
          const ct = r.headers.get('content-type') || '';
          let text = await r.text();
          if (/html/.test(ct)) text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
          result = { url, status: r.status, content: text.slice(0, 5000) };
        } catch (e) { result = { error: 'read fail: ' + String(e.message || e) }; }
      }
      title = '📄 Web read: ' + url.slice(11, 51);
    }
    else if (name === 'system_info') { result = { os: os.type() + ' ' + os.release(), hostname: os.hostname(), user: os.userInfo().username, cpu: os.cpus()[0] && os.cpus()[0].model, ram_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024), freemem_gb: Math.round(os.freemem() / 1024 / 1024 / 1024), uptime_h: Math.round(os.uptime() / 3600) }; title = '💻 System info'; }
    else if (name === 'android_project') {
      const home = os.homedir();
      const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
        (IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') :
         fs.existsSync(path.join(home, 'Android', 'Sdk')) ? path.join(home, 'Android', 'Sdk') :
         fs.existsSync(path.join(home, 'android-sdk')) ? path.join(home, 'android-sdk') : null);
      if (args.action === 'check') {
        title = '🤖 Android SDK check';
        const java = await sh('java -version 2>&1', 10000);
        const gradle = await sh((IS_WIN ? 'gradle.bat' : 'gradle') + ' --version 2>&1 | head -5', 15000);
        const adb = sdkDir ? await sh('"' + path.join(sdkDir, 'platform-tools', IS_WIN ? 'adb.exe' : 'adb') + '" version', 10000) : { ok: false, error: 'not found' };
        result = {
          jdk: java.ok ? (java.output || java.error).split('\n')[0] : 'Java nahi mila - JDK 17 install karo',
          jdk_ok: java.ok,
          gradle: gradle.ok ? ((gradle.output || '').split('\n').filter(l => l.includes('Gradle'))[0] || 'found') : 'Gradle nahi mila - gradle.org ya choco/brew se install karo',
          gradle_ok: gradle.ok,
          sdk: sdkDir && fs.existsSync(sdkDir) ? 'OK ' + sdkDir : 'Android SDK nahi mila - Android Studio install karo (developer.android.com)',
          sdk_ok: !!(sdkDir && fs.existsSync(sdkDir)),
          adb: adb.ok ? 'adb ready' : 'adb nahi mila',
          summary: 'APK build ke liye: JDK 17 + Android SDK + Gradle chahiye. Missing cheezon ke install commands bhi bata sakta hoon.'
        };
      } else if (args.action === 'create') {
        const appName = (args.name || 'MyApp').replace(/[^a-zA-Z0-9]/g, '') || 'MyApp';
        const pkg = args.package || ('com.devcraft.' + appName.toLowerCase());
        const dir = args.path || path.join(home, 'DevCraftApps', appName);
        const T = {
          'settings.gradle': 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name = "' + appName + '"\ninclude \'' + 'app' + '\'\n',
          'build.gradle': 'plugins { id "com.android.application" version "8.5.2" apply false }\n',
          'gradle.properties': 'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2048m\n',
          'app/build.gradle': 'plugins { id "com.android.application" }\nandroid {\n  namespace "' + pkg + '"\n  compileSdk 34\n  defaultConfig { applicationId "' + pkg + '"; minSdk 21; targetSdk 34; versionCode 1; versionName "1.0" }\n  buildTypes { release { minifyEnabled false } }\n  compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }\n}\n',
          'app/src/main/AndroidManifest.xml': '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application android:label="' + appName + '" android:icon="@android:drawable/ic_menu_compass" android:theme="@android:style/Theme.Material.Light.DarkActionBar">\n    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>\n    </activity>\n  </application>\n</manifest>\n',
          ['app/src/main/java/' + pkg.split('.').join('/') + '/MainActivity.java']: 'package ' + pkg + ';\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.widget.TextView;\npublic class MainActivity extends Activity {\n  @Override protected void onCreate(Bundle b) {\n    super.onCreate(b);\n    TextView tv = new TextView(this);\n    tv.setTextSize(22);\n    tv.setPadding(40, 120, 40, 40);\n    tv.setText("Hello! Ye app Dev Craft Agent ne banayi hai");\n    setContentView(tv);\n  }\n}\n'
        };
        for (const [f, c] of Object.entries(T)) {
          const fp = path.join(dir, f);
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, c, 'utf8');
        }
        if (sdkDir && fs.existsSync(sdkDir)) { fs.writeFileSync(path.join(dir, 'local.properties'), 'sdk.dir=' + sdkDir.replace(/\\/g, '/') + '\n', 'utf8'); }
        result = { ok: true, created: dir, package: pkg, files: Object.keys(T).length, note: sdkDir ? 'SDK mila - ab build action chalao' : 'SDK missing - pehle Android SDK install karo' };
        title = '🤖 Android project banaya: ' + appName;
      } else if (args.action === 'build') {
        const dir = args.path;
        title = '🤖 APK build: ' + path.basename(dir || '');
        if (!dir || !fs.existsSync(dir)) { result = { error: 'Project folder nahi mila: ' + dir }; }
        else {
          if (sdkDir && fs.existsSync(sdkDir) && !fs.existsSync(path.join(dir, 'local.properties'))) fs.writeFileSync(path.join(dir, 'local.properties'), 'sdk.dir=' + sdkDir.replace(/\\/g, '/') + '\n', 'utf8');
          const gradleCmd = IS_WIN ? 'gradle.bat' : 'gradle';
          const w = await sh(cd(dir) + gradleCmd + ' wrapper --gradle-version 8.7', 180000);
          if (!w.ok) result = { error: 'Gradle wrapper fail: ' + (w.error || w.output).slice(0, 300), tip: 'gradle install hai? android_project check chalao' };
          else {
            const buildCmd = IS_WIN ? 'gradlew.bat assembleDebug' : './gradlew assembleDebug';
            const b = await sh(cd(dir) + buildCmd, 600000);
            const apk = path.join(dir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
            result = b.ok && fs.existsSync(apk)
              ? { ok: true, apk: apk, size_mb: Math.round(fs.statSync(apk).size / 1024 / 1024 * 10) / 10, log_tail: (b.output || '').split('\n').slice(-5).join('\n') }
              : { error: 'Build fail: ' + ((b.error || b.output || '').split('\n').slice(-8).join('\n')).slice(0, 400), tip: 'android_project check chala ke SDK/JDK verify karo' };
          }
        }
      } else { result = { error: 'action: check | create | build' }; }
    }
    else if (name === 'package_app') {
      const home = os.homedir();
      const target = args.path;
      if (!target || !fs.existsSync(target)) { result = { error: 'Path nahi mila: ' + target }; }
      else if (args.action === 'to_exe') {
        title = '📦 EXE ban rahi hai: ' + path.basename(target);
        const isDir = fs.statSync(target).isDirectory();
        let entry = args.entry ? path.join(isDir ? target : path.dirname(target), args.entry) : null;
        if (isDir && !entry) for (const c of ['app.js', 'index.js', 'main.js']) { const f = path.join(target, c); if (fs.existsSync(f)) { entry = f; break; } }
        if (entry && fs.existsSync(entry) && entry.endsWith('.js')) {
          // Node script -> standalone EXE (pkg)
          const out = path.join(isDir ? target : path.dirname(target), path.basename(entry, '.js') + (IS_WIN ? '.exe' : '-bin'));
          const r = await sh('npx --yes pkg "' + entry + '" --output "' + out + '"', 420000);
          result = r.ok && fs.existsSync(out)
            ? { ok: true, exe: out, size_mb: Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10, note: 'Standalone EXE - Node install kiye bina chalegi (same OS pe)' }
            : { error: 'pkg se EXE nahi bani: ' + (r.error || r.output || '').split('\n').slice(-4).join(' ').slice(0, 300), tip: 'Alternatives: "npm i -g pkg" try karo, ya pyinstaller (python), ya 7-Zip SFX (folder)' };
        } else if (entry && fs.existsSync(entry) && entry.endsWith('.py')) {
          const r = await sh('pip install pyinstaller --quiet && pyinstaller --onefile "' + entry + '" --distpath "' + (isDir ? target : path.dirname(target)) + '"', 420000);
          const out = path.join(isDir ? target : path.dirname(target), path.basename(entry, '.py') + (IS_WIN ? '.exe' : ''));
          result = r.ok && fs.existsSync(out) ? { ok: true, exe: out } : { error: 'PyInstaller fail: ' + (r.error || '').slice(0, 200), tip: 'pip install pyinstaller' };
        } else {
          // Koi bhi folder -> self-extracting EXE (7-Zip SFX)
          const z7 = (await sh(IS_WIN ? 'where 7z 2>nul || echo "%ProgramFiles%\\7-Zip\\7z.exe"' : 'which 7z 7za 2>/dev/null', 8000));
          const z7path = (z7.output || '').split('\n')[0].replace(/^"|"$/g, '').trim();
          if (z7path && fs.existsSync(z7path)) {
            const out = target.replace(/[\\/]$/, '') + '.exe';
            const r = await sh('"' + z7path + '" a -sfx "' + out + '" "' + target + '"', 300000);
            result = r.ok && fs.existsSync(out) ? { ok: true, exe: out, size_mb: Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10, note: 'Self-extracting EXE - double-click se folder khud extract hoga' } : { error: '7z SFX fail: ' + (r.error || '').slice(0, 200) };
          } else {
            result = { error: '7-Zip nahi mila', tip: IS_WIN ? 'Install: winget install 7zip.7zip (ya 7-zip.org) phir dobara try karo' : 'Install: sudo apt install p7zip-full' };
          }
        }
      } else if (args.action === 'to_apk') {
        const isAndroid = fs.existsSync(path.join(target, 'app', 'src', 'main', 'AndroidManifest.xml'));
        if (isAndroid) {
          title = '📦 APK build (Android project)';
          result = JSON.parse(await runTool('android_project', { action: 'build', path: target }, steps));
          if (result.ok) title = '📦 APK ban gayi: ' + (result.size_mb || '?') + ' MB';
        } else {
          // HTML/website folder -> WebView wrapper app -> APK
          title = '📦 HTML folder → APK (WebView app)';
          const htmlOk = fs.existsSync(path.join(target, 'index.html')) || (fs.readdirSync(target).some(f => f.endsWith('.html')));
          if (!htmlOk) { result = { error: 'Is folder mein HTML file nahi milo - website folder do (index.html wala) ya Android project folder' }; }
          else {
            const appName = (args.name || path.basename(target)).replace(/[^a-zA-Z0-9]/g, '') || 'WebApp';
            const pkg = args.package || ('com.devcraft.' + appName.toLowerCase());
            const dir = path.join(home, 'DevCraftApps', appName + '-apk');
            const T = {
              'settings.gradle': 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name = "' + appName + '"\ninclude \'' + 'app' + '\'\n',
              'build.gradle': 'plugins { id "com.android.application" version "8.5.2" apply false }\n',
              'gradle.properties': 'android.useAndroidX=true\n',
              'app/build.gradle': 'plugins { id "com.android.application" }\nandroid {\n  namespace "' + pkg + '"\n  compileSdk 34\n  defaultConfig { applicationId "' + pkg + '"; minSdk 21; targetSdk 34; versionCode 1; versionName "1.0" }\n  buildTypes { release { minifyEnabled false } }\n  compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }\n}\n',
              'app/src/main/AndroidManifest.xml': '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-permission android:name="android.permission.INTERNET"/>\n  <application android:label="' + appName + '" android:icon="@android:drawable/ic_menu_compass" android:theme="@android:style/Theme.Material.Light.NoActionBar">\n    <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize">\n      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>\n    </activity>\n  </application>\n</manifest>\n',
              ['app/src/main/java/' + pkg.split('.').join('/') + '/MainActivity.java']: 'package ' + pkg + ';\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.webkit.WebView;\nimport android.webkit.WebViewClient;\npublic class MainActivity extends Activity {\n  WebView wv;\n  @Override protected void onCreate(Bundle b) {\n    super.onCreate(b);\n    wv = new WebView(this);\n    wv.getSettings().setJavaScriptEnabled(true);\n    wv.getSettings().setDomStorageEnabled(true);\n    wv.setWebViewClient(new WebViewClient());\n    wv.loadUrl("file:///android_asset/index.html");\n    setContentView(wv);\n  }\n  @Override public void onBackPressed() { if (wv != null && wv.canGoBack()) wv.goBack(); else super.onBackPressed(); }\n}\n'
            };
            for (const [f, c] of Object.entries(T)) { const fp = path.join(dir, f); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, c, 'utf8'); }
            // HTML folder -> assets mein copy (node_modules/.git skip)
            const assets = path.join(dir, 'app', 'src', 'main', 'assets');
            fs.mkdirSync(assets, { recursive: true });
            const skip = new Set(['node_modules', '.git', '.gradle', 'build']);
            (function copy(src, dstp) {
              for (const item of fs.readdirSync(src)) {
                if (skip.has(item)) continue;
                const sp = path.join(src, item), dp = path.join(dstp, item);
                if (fs.statSync(sp).isDirectory()) { fs.mkdirSync(dp, { recursive: true }); copy(sp, dp); }
                else fs.copyFileSync(sp, dp);
              }
            })(target, assets);
            result = { ok: true, project: dir, note: 'WebView app ban gayi - ab build chal rahi hai...' };
            const build = JSON.parse(await runTool('android_project', { action: 'build', path: dir }, steps));
            result = build.ok ? build : Object.assign({ wrapper: dir }, build);
            if (build.ok) title = '📦 APK ban gayi: ' + (build.size_mb || '?') + ' MB';
          }
        }
      } else { result = { error: 'action: to_exe | to_apk' }; }
    }
    else { result = { error: 'Unknown tool: ' + name }; }
  } catch (e) { result = { error: e.message }; }
  steps.push({ title, status: result && result.error && !result.ok ? 'error' : 'done', detail: (result && (result.output || result.error || result.saved || result.deleted || result.created || '') || '').toString().split('\n')[0].slice(0, 60) });
  return JSON.stringify(result);
}

// ---------- chat (OpenAI ya local Ollama) ----------
async function chat(req, res, body) {
  res.setHeader('Content-Type', 'application/json');
  const { message, history, api_key, provider, model, base_url, jarvis } = body || {};
  const sysPrompt = SYSTEM_PROMPT + (jarvis ? JARVIS_PROMPT : '');
  if (!message) return res.end(JSON.stringify({ error: 'message required' }));
  const steps = [];

  // ---- bonus: "$ cmd" pattern → seedha terminal (bina AI ke bhi chale) ----
  const cmdMatch = message.match(/^\s*(?:\$|cmd:|terminal:)\s*(.+)/i);
  if (cmdMatch) {
    const out = await sh(cmdMatch[1]);
    steps.push({ title: '⌨ Terminal (direct)', status: out.ok ? 'done' : 'error', detail: (out.output || out.error || 'done').split('\n')[0].slice(0, 60) });
    const out2 = '```\n' + (out.output || out.error || '(no output)') + '\n```';
    return res.end(JSON.stringify({ reply: jarvis ? ('Sir, command execute karta hoon.\n' + out2 + '\nSir, command complete ho gayi.') : out2, steps }));
  }

  // ---- Ollama (local, free) ----
  if (provider === 'ollama') {
    try {
      const r = await fetch('http://localhost:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: (ollamaCfg().model || model || 'llama3.2'), messages: [{ role: 'system', content: sysPrompt }, ...(Array.isArray(history) ? history.slice(-8) : []), { role: 'user', content: message }], stream: false }) });
      if (!r.ok) return res.end(JSON.stringify({ error: 'Ollama error (HTTP ' + r.status + ') - model installed? "ollama pull llama3.2"' }));
      const d = await r.json();
      return res.end(JSON.stringify({ reply: (d.message && d.message.content) || '', steps }));
    } catch (e) { return res.end(JSON.stringify({ error: 'Ollama nahi chal raha (localhost:11434). ollama.com se install karo ya Settings mein OpenAI key use karo.' })); }
  }

  // ---- PROVIDER RESOLVE: koi bhi AI (Settings ki key pehle; chat-wala brain sirf fallback) ----
  let effProv = (provider === 'claude') ? 'anthropic' : (provider || 'openai');
  if (effProv !== 'custom' && effProv !== 'ollama' && !BRAIN_PROVIDERS[effProv]) effProv = 'openai';
  let effKey = api_key, effUrl, effModel = model;
  const vBrainKey = vaultGet('BRAIN_API_KEY');
  if (vBrainKey && !effKey) {
    effProv = vaultGet('BRAIN_PROVIDER') || effProv;
    effKey = vBrainKey;
    const vUrl = vaultGet('BRAIN_BASE_URL');
    if (vUrl) effUrl = vUrl.replace(/\/+$/, '') + '/chat/completions';
    effModel = vaultGet('BRAIN_MODEL') || (BRAIN_PROVIDERS[effProv] ? BRAIN_PROVIDERS[effProv].model : model);
  }

  // ---- Gemini / ChatGPT / Claude / OpenRouter / Groq / DeepSeek / Mistral / Custom (OpenAI-compatible layer) ----
  const BRAIN_URL = effUrl || (effProv === 'custom' ? (base_url || '').replace(/\/+$/, '') + '/chat/completions' : BRAIN_PROVIDERS[effProv].url);
  const brainModel = effModel || (effProv === 'custom' ? 'custom-model' : BRAIN_PROVIDERS[effProv].model);
  if (!effKey) return res.end(JSON.stringify({ error: 'API key missing - Settings (⚙️) kholo, apna AI chuno (✨ Gemini FREE, ⚡ Groq FREE, 🔗 OpenRouter...) aur key paste karo. Ya 🦙 Ollama (offline, free) select karo.' }));
  if (provider === 'custom' && !base_url && !effUrl) return res.end(JSON.stringify({ error: 'Custom API ke liye Base URL Settings mein daalo' }));
  const messages = [{ role: 'system', content: sysPrompt }, ...(Array.isArray(history) ? history.slice(-10) : []), { role: 'user', content: message }];
  const jarvisSays = [];
  try {
    let reply = '';
    for (let round = 0; round < 8; round++) {
      const r = await fetch(BRAIN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + effKey },
        body: JSON.stringify({ model: brainModel, messages, tools: TOOLS, max_tokens: 1600 })
      });
      if (!r.ok) { const errTxt = await r.text(); return res.end(JSON.stringify({ error: 'OpenAI error: ' + errTxt.slice(0, 200) })); }
      const d = await r.json();
      const msg = d.choices[0].message;
      if (msg.tool_calls && msg.tool_calls.length) {
        if (jarvis && msg.content && msg.content.trim()) { jarvisSays.push(msg.content.trim()); steps.push({ title: '🤖 ' + msg.content.trim().slice(0, 60), status: 'active', detail: 'JARVIS' }); }
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          const result = await runTool(tc.function.name, args, steps);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 6000) });
        }
        continue;
      }
      reply = msg.content || '';
      break;
    }
    if (jarvis && jarvisSays.length) reply = jarvisSays.join('\n') + '\n' + (reply || 'Sir, task complete.');
    return res.end(JSON.stringify({ reply: reply || 'Kaam ho gaya 👆 (steps upar)', steps }));
  } catch (e) { return res.end(JSON.stringify({ error: 'Network error: ' + e.message })); }
}

// ---------- server ----------
const HTML = fs.existsSync(path.join(__dirname, 'desktop.html')) ? fs.readFileSync(path.join(__dirname, 'desktop.html'), 'utf8') : '<h1>desktop.html missing!</h1>';

// ---------- SELF-TEST MODE: node app.js --test ----------
async function selfTest() {
  console.log('=== DEV CRAFT AGENT SELF-TEST ===\n');
  const results = [];
  const T = async (name, fn) => {
    try { const detail = await fn(); results.push({ name, ok: true, detail: detail || '' }); console.log('  PASS  ' + name + (detail ? '  - ' + detail : '')); }
    catch (e) { results.push({ name, ok: false, detail: String(e.message || e).slice(0, 80) }); console.log('  FAIL  ' + name + '  - ' + String(e.message || e).slice(0, 80)); }
  };
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assert fail'); };

  const home = os.homedir(), tmp = path.join(home, 'devcraft-test-' + Date.now());
  await T('terminal command (echo)', async () => {
    const r = await sh('echo hello-test', 10000);
    assert(r.ok && (r.output || '').includes('hello-test'), JSON.stringify(r).slice(0, 100));
    return 'echo works';
  });
  await T('file_write + read + edit + delete', async () => {
    const steps = [];
    const r1 = JSON.parse(await runTool('file_write', { path: path.join(tmp, 'sub', 't.txt'), content: 'line1' }, steps));
    const r2 = JSON.parse(await runTool('file_read', { path: path.join(tmp, 'sub', 't.txt') }, steps));
    JSON.parse(await runTool('file_write', { path: path.join(tmp, 'sub', 't.txt'), content: 'line1\nline2-EDITED' }, steps));
    const r4 = JSON.parse(await runTool('file_read', { path: path.join(tmp, 'sub', 't.txt') }, steps));
    const r5 = JSON.parse(await runTool('file_delete', { path: path.join(tmp, 'sub', 't.txt') }, steps));
    assert(r1.ok && r2.content === 'line1' && r4.content.includes('EDITED') && r5.ok, 'r1=' + JSON.stringify(r1) + ' r2=' + JSON.stringify(r2) + ' r4=' + JSON.stringify(r4).slice(0,50) + ' r5=' + JSON.stringify(r5));
    return 'CRUD ok';
  });
  await T('folder create + list + delete', async () => {
    const steps = [];
    const r1 = JSON.parse(await runTool('file_write', { path: path.join(tmp, 'a', 'b', 'c.txt'), content: 'x' }, steps));
    JSON.parse(await runTool('file_list', { path: tmp }, steps));
    const r3 = JSON.parse(await runTool('file_delete', { path: tmp }, steps));
    assert(r1.ok && r3.ok, 'folder ops fail');
    return 'ok';
  });
  await T('credential vault (save/list/get/delete + placeholder)', async () => {
    vaultSet('TEST_TOKEN', 'ghp_abcd12345678efgh', 'self-test');
    const lst = vaultList();
    assert(lst.credentials.some(c => c.name === 'TEST_TOKEN' && c.masked.includes('••••')), 'list/mask fail');
    assert(vaultGet('TEST_TOKEN') === 'ghp_abcd12345678efgh', 'get fail');
    assert(vaultExpand('echo {{TEST_TOKEN}}') === 'echo ghp_abcd12345678efgh', 'placeholder fail');
    const del = vaultDel('TEST_TOKEN');
    assert(del.ok && vaultGet('TEST_TOKEN') === null, 'delete fail');
    return 'vault ok';
  });
  await T('system_info', async () => {
    const steps = [];
    const r = JSON.parse(await runTool('system_info', {}, steps));
    assert(r.os, 'info missing');
    return (r.os || '').slice(0, 40);
  });
  await T('android SDK check', async () => {
    const steps = [];
    const r = JSON.parse(await runTool('android_project', { action: 'check' }, steps));
    return 'JDK:' + (r.jdk_ok ? 'OK' : 'nahi') + ' SDK:' + (r.sdk_ok ? 'OK' : 'nahi') + ' Gradle:' + (r.gradle_ok ? 'OK' : 'nahi');
  });
  await T('Ollama (optional)', async () => {
    const r = await sh('ollama list 2>/dev/null', 8000);
    return r.ok ? 'models mil gaye' : 'skip - ollama install nahi (optional)';
  });
  await T('7-Zip (exe ke liye, optional)', async () => {
    const r = await sh(IS_WIN ? 'where 7z' : 'which 7z 7za', 5000);
    return r.ok ? '7z mila - SFX exe possible' : 'skip - 7-Zip install nahi (optional)';
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  const pass = results.filter(r => r.ok).length;
  console.log('\n=== RESULT: ' + pass + '/' + results.length + ' PASS ===');
  console.log('AI brain alag test: app chalao (node app.js) > browser > message bhejo');
  process.exit(results.some(r => !r.ok) ? 1 : 0);
}
if (process.argv.includes('--test')) { selfTest(); return; }

// ---------- CLOUD BRIDGE (cloud website / mobile se ye laptop control) ----------
const BRIDGE_API = 'https://dev-craft-agent.vercel.app/api/bridge';
const BRIDGE_FILE = path.join(os.homedir(), '.dev-craft', 'bridge.json');
function bridgeLoad() { try { return JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8')); } catch (e) { return null; } }
function bridgeSave(o) { fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true }); fs.writeFileSync(BRIDGE_FILE, JSON.stringify(o, null, 2)); }
function bridgeStatus() { const b = bridgeLoad(); return { paired: !!(b && b.device_id), device_id: b ? b.device_id : null, device_name: b ? b.device_name : null }; }
async function bridgeApi(payload) {
  const r = await fetch(BRIDGE_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!d.success && d.error) throw new Error(d.error);
  return d;
}
async function bridgePair(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) throw new Error('Pairing code paste karo (website > Connect PC > Get pairing code)');
  const d = await bridgeApi({ action: 'register', code: c, device_name: os.hostname(), os: os.type() + ' ' + os.release() });
  bridgeSave({ device_id: d.device_id, device_name: d.device_name || os.hostname(), paired_at: new Date().toISOString() });
  bridgeStart();
  return d;
}
async function bridgeOff() {
  const b = bridgeLoad();
  if (b && b.device_id) { try { await bridgeApi({ action: 'disconnect', device_id: b.device_id }); } catch (e) {} }
  try { fs.unlinkSync(BRIDGE_FILE); } catch (e) {}
  if (bridgeTimer) { clearInterval(bridgeTimer); bridgeTimer = null; }
}
let bridgeTimer = null;
async function bridgeTick() {
  const b = bridgeLoad();
  if (!b || !b.device_id) return;
  try {
    const d = await bridgeApi({ action: 'poll', device_id: b.device_id });
    for (const job of (d.jobs || [])) {
      (async () => {
        let result = {}, st = 'done';
        try {
          const steps = [];
          if (job.type === 'shell') result = JSON.parse(await runTool('run_command', { command: (job.payload && job.payload.command) || 'echo no command', timeout: 120 }, steps));
          else if (job.type === 'tool') result = JSON.parse(await runTool((job.payload && job.payload.tool) || '', (job.payload && job.payload.args) || {}, steps));
          else { result = { error: 'Unknown job type: ' + job.type }; st = 'error'; }
          if (result.error) st = 'error';
        } catch (e) { result = { error: String(e.message || e) }; st = 'error'; }
        try { await bridgeApi({ action: 'result', job_id: job.id, status: st, result }); } catch (e) {}
        console.log('🌉 Cloud job ' + (st === 'done' ? 'DONE' : 'FAIL') + ': ' + job.type + ' — ' + String((job.payload && (job.payload.command || job.payload.tool)) || '').slice(0, 60));
      })();
    }
  } catch (e) { /* cloud offline / net down — chup rehkar agla poll try karo */ }
}
function bridgeStart() { if (bridgeTimer) return; bridgeTimer = setInterval(() => { bridgeTick().catch(() => {}); }, 4000); bridgeTick().catch(() => {}); }

// ---------- LOCAL AUTOMATIONS (laptop scheduler) ----------
const AUTOS_PATH = path.join(os.homedir(), '.dev-craft', 'automations.json');
function autosLoad() { try { return JSON.parse(fs.readFileSync(AUTOS_PATH, 'utf8')); } catch (e) { return []; } }
function autosSave(list) { fs.mkdirSync(path.dirname(AUTOS_PATH), { recursive: true }); fs.writeFileSync(AUTOS_PATH, JSON.stringify(list, null, 2)); }
async function autoFire(a) {
  const steps = [];
  try { return await runTool(a.tool || 'whatsapp_send', a.args || {}, steps); }
  catch (e) { return JSON.stringify({ error: String(e.message || e) }); }
}
async function autosCheck() {
  const list = autosLoad();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const mins = now.getHours() * 60 + now.getMinutes();
  let changed = false;
  for (const a of list) {
    if (a.enabled === false) continue;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(a.time || '')); if (!m) continue;
    const target = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (mins >= target && a.last_fired !== today) {
      const out = await autoFire(a);
      a.attempts = (a.attempts || 0) + 1;
      let ok = true; try { const r = JSON.parse(out); ok = !r.error; } catch (e) {}
      if (ok || a.attempts >= 6) {
        a.last_fired = today; a.last_run = new Date().toISOString(); a.last_ok = ok; a.attempts = 0;
        if ((a.repeat || 'daily') === 'once') a.enabled = false;
      }
      changed = true;
      console.log('⏰ Automation ' + (ok ? 'SENT' : 'FAIL') + ': ' + (a.name || a.id) + (ok ? '' : ' → ' + out.slice(0, 100)));
    }
  }
  if (changed) autosSave(list);
}
setInterval(() => { autosCheck().catch(() => {}); }, 30000);
autosCheck().catch(() => {}); // startup catch-up — laptop late khula to pending message abhi chala jayega

http.createServer((req, res) => {
  // CORS — cloud website (same laptop browser) se direct terminal ke liye
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(HTML); }
  if (req.method === 'GET' && req.url === '/api/credentials') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(vaultList())); }
  if (req.method === 'GET' && req.url === '/api/bridge/status') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(bridgeStatus())); }
  if (req.method === 'GET' && req.url === '/api/models') { res.setHeader('Content-Type', 'application/json'); ollamaInfo().then(d => res.end(JSON.stringify({ models: d.models, installed: d.installed, running: d.running, active_model: ollamaCfg().model }))).catch(() => res.end(JSON.stringify({ models: [], installed: false, running: false }))); return; }
  if (req.method === 'GET' && req.url === '/api/ollama/pull_status') { res.setHeader('Content-Type', 'application/json'); ollamaInfo().then(d => res.end(JSON.stringify({ state: ollamaPullState, models: d.models, running: d.running }))).catch(() => res.end(JSON.stringify({ state: ollamaPullState, models: [], running: false }))); return; }
  if (req.method === 'GET' && req.url === '/api/ollama/install_status') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(_ollamaInstallState)); }
  if (req.method === 'POST') {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(buf || '{}'); } catch (e) {}
      if (req.url === '/api/chat') return chat(req, res, body);
      if (req.url === '/api/models') {
        try { const d = await ollamaInfo(); return res.end(JSON.stringify({ models: d.models, installed: d.installed, running: d.running })); }
        catch (e) { return res.end(JSON.stringify({ models: [], installed: false, running: false })); }
      }
      if (req.url === '/api/ollama/pull') return res.end(JSON.stringify(await ollamaPullRequest(body.model)));
      if (req.url === '/api/ollama/select') {
        const model = String(body.model || '').trim();
        const d = await ollamaInfo();
        if (!d.running) return res.end(JSON.stringify({ ok: false, error: 'Ollama chal nahi raha' }));
        if (!d.models.some(m => m.split(':')[0] === model.split(':')[0])) return res.end(JSON.stringify({ ok: false, error: 'Model installed nahi: ' + model }));
        ollamaCfgSet(model);
        return res.end(JSON.stringify({ ok: true, active_model: model }));
      }
      if (req.url === '/api/ollama/install') return res.end(JSON.stringify(ollamaInstallStart()));
      if (req.url === '/api/ping') return res.end(JSON.stringify({ ok: true, app: 'Dev Craft Desktop v1', os: os.type() }));
      if (req.url === '/api/exec') {
        try {
          const out = JSON.parse(await runTool('run_command', { command: vaultExpand(body.command || 'echo no command'), timeout: Math.min(120, body.timeout || 60) }, []));
          return res.end(JSON.stringify({ ok: !out.error, output: out.output || out.error || '', exit: out.exit != null ? out.exit : (out.error ? 1 : 0) }));
        } catch (e) { return res.end(JSON.stringify({ ok: false, output: String(e.message || e), exit: 1 })); }
      }
      if (req.url === '/api/bridge/pair') { try { const d = await bridgePair(body.code || ''); return res.end(JSON.stringify({ ok: true, device_id: d.device_id })); } catch (e) { return res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); } }
      if (req.url === '/api/bridge/disconnect') { await bridgeOff(); return res.end(JSON.stringify({ ok: true })); }
      if (req.url === '/api/mcp') {
        res.setHeader('Content-Type', 'application/json');
        const b = body || {};
        const d = mcpLoad();
        if (b.action === 'save') {
          if (!b.name || !b.url) return res.end(JSON.stringify({ error: 'name aur url chahiye' }));
          d[String(b.name).toLowerCase().trim()] = { url: b.url, token: b.token || null, updated_at: new Date().toISOString() };
          mcpSaveLocal(d);
          return res.end(JSON.stringify({ ok: true, saved: b.name }));
        }
        if (b.action === 'delete') { delete d[String(b.name).toLowerCase().trim()]; mcpSaveLocal(d); return res.end(JSON.stringify({ ok: true })); }
        if (b.action === 'test') {
          try {
            const cfg = d[String(b.name || '').toLowerCase().trim()] || (b.url ? { url: b.url, token: b.token || null } : null);
            if (!cfg) return res.end(JSON.stringify({ error: 'server nahi mila' }));
            const tools = await mcpListTools(cfg.url, cfg.token);
            return res.end(JSON.stringify({ ok: true, tools: tools.slice(0, 40) }));
          } catch (e) { return res.end(JSON.stringify({ error: e.message.slice(0, 200) })); }
        }
        if (b.action === 'call') {
          try {
            const cfg = d[String(b.name || '').toLowerCase().trim()];
            if (!cfg) return res.end(JSON.stringify({ error: 'server nahi mila' }));
            const r = await mcpCallToolFn(cfg.url, cfg.token, b.tool, b.args || {});
            return res.end(JSON.stringify(r));
          } catch (e) { return res.end(JSON.stringify({ error: e.message.slice(0, 200) })); }
        }
        return res.end(JSON.stringify({ servers: Object.keys(d).map(k => ({ name: k, url: d[k].url })) }));
      }
      if (req.url === '/api/credentials') {
        res.setHeader('Content-Type', 'application/json');
        const b = body || {};
        if (b.action === 'list' || !b.action) return res.end(JSON.stringify(vaultList()));
        if (b.action === 'save') return res.end(JSON.stringify(vaultSet(b.name, b.value, b.description)));
        if (b.action === 'delete') return res.end(JSON.stringify(vaultDel(b.name)));
        return res.end(JSON.stringify({ error: 'action: save | list | delete' }));
      }
      res.statusCode = 404; res.end('{}');
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(PORT, async () => {
  console.log('\n⚡ DEV CRAFT AGENT - DESKTOP v1');
  console.log('   ➜ Browser mein kholo: http://localhost:' + PORT);
  console.log('   ' + (IS_WIN ? 'OS: Windows' : IS_MAC ? 'OS: macOS' : 'OS: Linux') + ' | User: ' + os.userInfo().username);
  console.log('\n   Powers: terminal ✅ files ✅ apps ✅ YouTube ✅ Chrome ✅ WhatsApp Web ✅ Automations ⏰ + system_check 🔍');
  if (bridgeStatus().paired) { bridgeStart(); console.log('   🌉 Cloud Bridge: CONNECTED (website/mobile se ye laptop control ho sakta hai)'); }
  else console.log('   🌉 Cloud Bridge: OFF (Settings → Cloud Bridge se pair karo)');
  console.log('   AI: Settings mein OpenAI key ya local Ollama (free)\n');
  try { await openTarget('http://localhost:' + PORT); console.log('   Browser khul gaya! (na khula to manually kholo)'); } catch (e) {}
});

// (test export - production mein koi asar nahi)
if (process.env.DCD_EXPORT) module.exports = { runTool, selfTest };
