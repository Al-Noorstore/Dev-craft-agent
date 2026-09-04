#!/usr/bin/env node
// ============================================
// DEV CRAFT AGENT - PC BRIDGE
// Apne PC/laptop ko Dev Craft Agent se connect karta hai.
// Agent phir tumhare PC pe commands chala sakta hai aur
// local Ollama models use kar sakta hai (real-time).
//
// CHALANE KA TARIKA:
//   1. Node.js 18+ install hona chahiye (https://nodejs.org)
//   2. Ye repo download/clone karo (ya sirf ye file bhi chalegi)
//   3. Agent website pe "Connect PC" > "Get pairing code" dabao
//   4. Terminal mein chalao:
//        node bridge.js <PAIRING-CODE>
//      Example: node bridge.js A1B2C3
//   5. Website pe "PC Connected" dikhega ✅
//
// Optional: agla arg server URL (default: dev-craft-agent.vercel.app)
//   node bridge.js A1B2C3 https://dev-craft-agent.vercel.app
//
// OLLAMA: https://ollama.com install karo + models download karo
//   (ollama pull llama3.2). Bridge khud detect karke website pe
//   dikhayega. Band karne ke liye: Ctrl+C
// ============================================
const { exec } = require('child_process');
const os = require('os');

const CODE = process.argv[2];
const BASE = (process.argv[3] || 'https://dev-craft-agent.vercel.app').replace(/\/+$/, '');
const POLL_MS = 2000;
const OLLAMA_URL = 'http://localhost:11434';

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const OS_NAME = isWin ? 'Windows ' + (require('os').release().split('.')[0] === '10' ? '10/11' : require('os').release()) : (isMac ? 'macOS ' + require('os').release() : 'Linux/' + (require('os').version && require('os').version().split('\n')[0] || 'linux'));

if (!CODE) {
  console.log('\n❌ Pairing code do! Usage: node bridge.js <PAIRING-CODE>');
  console.log('   Website pe "Connect PC" > "Get pairing code" dabao.\n');
  process.exit(1);
}

const DEVICE_NAME = os.hostname() + ' (' + (isWin ? 'Windows' : isMac ? 'Mac' : 'Linux') + ')';

async function api(action, body) {
  const res = await fetch(BASE + '/api/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body })
  });
  return res.json();
}

let ollamaModels = [];

async function refreshOllama() {
  try {
    const r = await fetch(OLLAMA_URL + '/api/tags');
    if (r.ok) {
      const d = await r.json();
      ollamaModels = (d.models || []).map(m => m.name);
      return;
    }
  } catch (e) { /* ollama nahi chal raha */ }
  ollamaModels = [];
}

async function handleJob(job) {
  const { type, payload, id } = job;
  try {
    if (type === 'shell') {
      const result = await new Promise((resolve) => {
        exec(payload.command || 'echo no command', { timeout: 30000, maxBuffer: 1024 * 1024, cwd: payload.cwd || undefined }, (err, stdout, stderr) => {
          resolve({ ok: !err, output: (stdout || '').slice(0, 8000), error_output: (stderr || '').slice(0, 3000), exit_code: err ? (err.code || 1) : 0 });
        });
      });
      console.log('  ⌨ command done:', (payload.command || '').slice(0, 60));
      return await api('result', { job_id: id, result });
    }
    if (type === 'ollama_chat') {
      const r = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.model || (ollamaModels[0] || 'llama3.2'),
          messages: payload.messages || [{ role: 'user', content: payload.prompt || '' }],
          stream: false
        })
      });
      if (!r.ok) return await api('result', { job_id: id, status: 'error', result: { error: 'Ollama error (model installed hai? ollama pull <model>) HTTP ' + r.status } });
      const d = await r.json();
      return await api('result', { job_id: id, result: { reply: (d.message && d.message.content) || '' } });
    }
    if (type === 'ollama_models') {
      await refreshOllama();
      return await api('result', { job_id: id, result: { models: ollamaModels } });
    }
    return await api('result', { job_id: id, status: 'error', result: { error: 'Unknown job type: ' + type } });
  } catch (e) {
    return await api('result', { job_id: id, status: 'error', result: { error: e.message } });
  }
}

async function main() {
  console.log('\n⚡ DEV CRAFT AGENT - PC BRIDGE');
  console.log('   Server:', BASE);
  console.log('   Code:  ', CODE, '\n');
  await refreshOllama();
  const reg = await api('register', { code: CODE, device_name: DEVICE_NAME, os: OS_NAME, ollama_models: ollamaModels });
  if (!reg.success) { console.log('❌ Register failed:', reg.error); process.exit(1); }
  const deviceId = reg.device_id;
  console.log('✅ Connected! Device:', DEVICE_NAME, '| ID:', deviceId);
  if (ollamaModels.length) console.log('🦙 Ollama models mile:', ollamaModels.join(', '));
  else console.log('🦙 Ollama nahi mila (optional) - install: ollama.com, phir "ollama pull llama3.2"');
  console.log('\nAgent ab tumhare PC pe commands chala sakta hai. Band karne ke liye Ctrl+C.\n');

  let lastOllamaCheck = 0;
  let inFlight = false;
  setInterval(async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (Date.now() - lastOllamaCheck > 30000) { await refreshOllama(); lastOllamaCheck = Date.now(); }
      const r = await api('poll', { device_id: deviceId, ollama_models: ollamaModels });
      if (r.success && r.jobs && r.jobs.length) {
        for (const job of r.jobs) {
          console.log('📥 Job mila:', job.type, '-', (job.payload && (job.payload.command || job.payload.prompt) || '').slice(0, 60));
          handleJob(job); // async - parallel chale
        }
      }
    } catch (e) {
      console.log('⚠ Poll error (retrying):', e.message);
    } finally { inFlight = false; }
  }, POLL_MS);
}

process.on('SIGINT', async () => {
  console.log('\n👋 Bridge band ho raha hai...');
  try { await api('disconnect', { device_id: deviceId }); } catch (e) {}
  process.exit(0);
});

main();
