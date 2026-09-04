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
const { exec } = require('child_process');

const PORT = 3155;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ---------- helpers ----------
function sh(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    exec(command, { timeout: Math.min(timeoutMs, 120000), maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '').slice(0, 6000), error: (stderr || '').slice(0, 2000) || (err ? err.message : ''), exit: err ? (err.code || 1) : 0 });
    });
  });
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

// ---------- TOOLS (OpenClaw powers) ----------
const TOOLS = [
  { type: 'function', function: { name: 'run_command', description: 'Laptop ke terminal mein koi bhi command chalao (npm, git, dir/ls, ping, python - anything). Output wapas milta hai.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'terminal command' }, cwd: { type: 'string', description: 'working directory (optional)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'file_write', description: 'File banao ya edit karo - poora content likho. Kisi bhi folder mein.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'file_read', description: 'Kisi bhi file ka content padho', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_list', description: 'Folder ka content dekho (files/subfolders)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'folder path, e.g. C:\\Users\\Noora\\Downloads ya ~/Documents' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_delete', description: 'File YA folder delete karo (permanently!). Bade/risky delete se pehle user se CONFIRM karo.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'folder_create', description: 'Naya folder banao', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'open_app', description: 'App, file ya website kholo. Examples: "notepad", "C:\\Program Files\\...\\app.exe", "https://youtube.com", koi bhi file.', parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } } },
  { type: 'function', function: { name: 'close_app', description: 'App band karo (process kill). Process name do, e.g. "notepad", "chrome", "vlc".', parameters: { type: 'object', properties: { process_name: { type: 'string' } }, required: ['process_name'] } } },
  { type: 'function', function: { name: 'youtube', description: 'YouTube control karo: search, video open, ya YouTube band karo.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['search', 'open', 'close'], description: 'search = YouTube pe search karo (query do), open = video/channel URL kholo (url do), close = YouTube browser tab/app band' }, query: { type: 'string' }, url: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'system_info', description: 'PC ki info: OS, RAM, disk, current user, IP', parameters: { type: 'object', properties: {} } } }
];

const SYSTEM_PROMPT = `You are Dev Craft Agent DESKTOP - running directly on the user's own laptop/PC (OpenClaw-style power user assistant). You have FULL tools:
- run_command (terminal), file_write/file_read/file_list/file_delete/folder_create (file system), open_app/close_app (apps), youtube (search/open/close), system_info.

RULES:
1. User Roman Urdu/Urdu/English mein baat karega - usi language mein jawab do (Roman Urdu mix theek hai).
2. Jaldi kaam karo - tools use karo, sirf advice nahi.
3. DESTRUCTIVE kaam (file_delete, format, rm -rf, mass delete) se pehle EK baar confirm karo: "ye delete karun? [haan/na]".
4. Commands ke liye OS ke mutabiq commands use karo (Windows: dir, taskkill; Linux/Mac: ls, pkill). User ka OS: __OS__.
5. Har tool ke result ke baad chhota summary do. Final reply concise rakho.
6. YouTube search: youtube tool {action:"search", query}. App kholna: open_app. Band karna: close_app (process name).
7. File paths mein spaces ho to quotes use karo.`.replace('__OS__', IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux');

// ---------- tool executor ----------
async function runTool(name, args, steps) {
  let title = name, result = {};
  try {
    if (name === 'run_command') { title = '⌨ Terminal: ' + String(args.command || '').slice(0, 50); result = await sh(args.command, 60000); }
    else if (name === 'file_write') { fs.writeFileSync(args.path, args.content || '', 'utf8'); result = { ok: true, saved: args.path }; title = '📝 File likhi: ' + path.basename(args.path); }
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
      if (args.action === 'search') { result = await openTarget('https://www.youtube.com/results?search_query=' + encodeURIComponent(args.query || '')); title = '📺 YouTube search: ' + (args.query || '').slice(0, 40); }
      else if (args.action === 'open') { result = await openTarget(args.url || 'https://youtube.com'); title = '📺 YouTube khola'; }
      else { result = await killProcess(IS_WIN ? 'chrome' : 'firefox'); title = '📺 YouTube/browser band'; }
    }
    else if (name === 'system_info') { result = { os: os.type() + ' ' + os.release(), hostname: os.hostname(), user: os.userInfo().username, cpu: os.cpus()[0] && os.cpus()[0].model, ram_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024), freemem_gb: Math.round(os.freemem() / 1024 / 1024 / 1024), uptime_h: Math.round(os.uptime() / 3600) }; title = '💻 System info'; }
    else { result = { error: 'Unknown tool: ' + name }; }
  } catch (e) { result = { error: e.message }; }
  steps.push({ title, status: result && result.error && !result.ok ? 'error' : 'done', detail: (result && (result.output || result.error || result.saved || result.deleted || result.created || '') || '').toString().split('\n')[0].slice(0, 60) });
  return JSON.stringify(result);
}

// ---------- chat (OpenAI ya local Ollama) ----------
async function chat(req, res, body) {
  res.setHeader('Content-Type', 'application/json');
  const { message, history, api_key, provider, model, base_url } = body || {};
  if (!message) return res.end(JSON.stringify({ error: 'message required' }));
  const steps = [];

  // ---- bonus: "$ cmd" pattern → seedha terminal (bina AI ke bhi chale) ----
  const cmdMatch = message.match(/^\s*(?:\$|cmd:|terminal:)\s*(.+)/i);
  if (cmdMatch) {
    const out = await sh(cmdMatch[1]);
    steps.push({ title: '⌨ Terminal (direct)', status: out.ok ? 'done' : 'error', detail: (out.output || out.error || 'done').split('\n')[0].slice(0, 60) });
    return res.end(JSON.stringify({ reply: '```\n' + (out.output || out.error || '(no output)') + '\n```', steps }));
  }

  // ---- Ollama (local, free) ----
  if (provider === 'ollama') {
    try {
      const r = await fetch('http://localhost:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model || 'llama3.2', messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...(Array.isArray(history) ? history.slice(-8) : []), { role: 'user', content: message }], stream: false }) });
      if (!r.ok) return res.end(JSON.stringify({ error: 'Ollama error (HTTP ' + r.status + ') - model installed? "ollama pull llama3.2"' }));
      const d = await r.json();
      return res.end(JSON.stringify({ reply: (d.message && d.message.content) || '', steps }));
    } catch (e) { return res.end(JSON.stringify({ error: 'Ollama nahi chal raha (localhost:11434). ollama.com se install karo ya Settings mein OpenAI key use karo.' })); }
  }

  // ---- OpenAI / OpenRouter / Custom (OpenAI-compatible) ----
  const BRAIN_URL = provider === 'openrouter' ? 'https://openrouter.ai/v1/chat/completions'
    : provider === 'custom' ? (base_url || '').replace(/\/+$/, '') + '/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const brainModel = model || (provider === 'openrouter' ? 'openrouter/auto' : provider === 'custom' ? 'custom-model' : 'gpt-4o-mini');
  if (!api_key) return res.end(JSON.stringify({ error: 'API key missing - Settings (⚙️) mein apni API key paste karo (OpenAI/OpenRouter/Custom), ya Ollama select karo (free).' }));
  if (provider === 'custom' && !base_url) return res.end(JSON.stringify({ error: 'Custom API ke liye Base URL Settings mein daalo' }));
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...(Array.isArray(history) ? history.slice(-10) : []), { role: 'user', content: message }];
  try {
    let reply = '';
    for (let round = 0; round < 8; round++) {
      const r = await fetch(BRAIN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key },
        body: JSON.stringify({ model: brainModel, messages, tools: TOOLS, max_tokens: 1600 })
      });
      if (!r.ok) { const errTxt = await r.text(); return res.end(JSON.stringify({ error: 'OpenAI error: ' + errTxt.slice(0, 200) })); }
      const d = await r.json();
      const msg = d.choices[0].message;
      if (msg.tool_calls && msg.tool_calls.length) {
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
    return res.end(JSON.stringify({ reply: reply || 'Kaam ho gaya 👆 (steps upar)', steps }));
  } catch (e) { return res.end(JSON.stringify({ error: 'Network error: ' + e.message })); }
}

// ---------- server ----------
const HTML = fs.existsSync(path.join(__dirname, 'desktop.html')) ? fs.readFileSync(path.join(__dirname, 'desktop.html'), 'utf8') : '<h1>desktop.html missing!</h1>';

http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(HTML); }
  if (req.method === 'POST') {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(buf || '{}'); } catch (e) {}
      if (req.url === '/api/chat') return chat(req, res, body);
      if (req.url === '/api/models') {
        try { const r = await fetch('http://localhost:11434/api/tags'); const d = await r.json(); return res.end(JSON.stringify({ models: (d.models || []).map(m => m.name) })); }
        catch (e) { return res.end(JSON.stringify({ models: [] })); }
      }
      if (req.url === '/api/ping') return res.end(JSON.stringify({ ok: true, app: 'Dev Craft Desktop v1', os: os.type() }));
      res.statusCode = 404; res.end('{}');
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(PORT, async () => {
  console.log('\n⚡ DEV CRAFT AGENT - DESKTOP v1');
  console.log('   ➜ Browser mein kholo: http://localhost:' + PORT);
  console.log('   ' + (IS_WIN ? 'OS: Windows' : IS_MAC ? 'OS: macOS' : 'OS: Linux') + ' | User: ' + os.userInfo().username);
  console.log('\n   Powers: terminal ✅ files/folders edit+delete ✅ apps open/close ✅ YouTube ✅');
  console.log('   AI: Settings mein OpenAI key ya local Ollama (free)\n');
  try { await openTarget('http://localhost:' + PORT); console.log('   Browser khul gaya! (na khula to manually kholo)'); } catch (e) {}
});
