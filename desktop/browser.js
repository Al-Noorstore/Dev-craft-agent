// ============================================
// BROWSER AUTOMATION (desktop) — browser.js
// Zero npm deps (Node 18+): system Chrome/Edge +
// CDP + apna mini WebSocket client. WhatsApp Web
// wale browser se hi share karta hai (agar chalu
// hai to same window, warna khud launch).
// - ytOpen()               → YouTube tab kholo/focus
// - ytSearch(q, separate)  → same tab ya naye tab mein search
// - ytPlay(n)              → khuli results mein se nth video play
// - ytSearchPlay(q, n)     → search karke nth video play
// - ytClose()              → YouTube tabs band
// ============================================
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEBUG_PORT = 9333;
const PROFILE_DIR = path.join(os.homedir(), '.dev-craft', 'wa-profile');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpJson(url) {
  return new Promise((resolve) => {
    http.get(url, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } }); }).on('error', () => resolve(null));
  });
}

function findBrowser() {
  let cands = [];
  if (process.platform === 'win32') {
    cands = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
  } else if (process.platform === 'darwin') {
    cands = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  } else {
    cands = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  }
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch (e) {} }
  try {
    const { execSync } = require('child_process');
    const out = execSync('which google-chrome google-chrome-stable chromium chromium-browser microsoft-edge 2>/dev/null', { encoding: 'utf8' });
    const f = String(out || '').split(/\s+/).find(Boolean);
    if (f) return f;
  } catch (e) {}
  return null;
}

// ---- mini WebSocket client (RFC6455 client-side, zero deps) ----
function wsConnect(host, port, path0) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host, port, path: path0, headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13'
    } });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('WS handshake timeout')); });
    req.on('upgrade', (res, socket, head) => {
      const inbox = []; let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
      const handlers = {};
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (true) {
          if (buf.length < 2) break;
          const b0 = buf[0], b1 = buf[1];
          const opcode = b0 & 0x0f;
          let len = b1 & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) break;
          const payload = buf.slice(off, off + len);
          buf = buf.slice(off + len);
          if (opcode === 1 || opcode === 2) { const txt = payload.toString('utf8'); for (const h of inbox.splice(0)) h(txt); }
          else if (opcode === 8) { try { socket.end(); } catch (e) {} if (handlers.close) handlers.close(); return; }
          else if (opcode === 9) {
            const mask = crypto.randomBytes(4);
            try { socket.write(Buffer.concat([Buffer.from([0x8a, 0x80]), mask])); } catch (e) {}
          }
        }
      });
      socket.on('error', () => {});
      socket.on('close', () => { if (handlers.close) handlers.close(); });
      resolve({
        onMessage(fn) { inbox.push(fn); },
        onClose(fn) { handlers.close = fn; },
        send(str) {
          const data = Buffer.from(str, 'utf8');
          const mask = crypto.randomBytes(4);
          let hdr;
          if (data.length < 126) { hdr = Buffer.alloc(2); hdr[1] = 0x80 | data.length; }
          else if (data.length < 65536) { hdr = Buffer.alloc(4); hdr[1] = 0x80 | 126; hdr.writeUInt16BE(data.length, 2); }
          else { hdr = Buffer.alloc(10); hdr[1] = 0x80 | 127; hdr.writeBigUInt64BE(BigInt(data.length), 2); }
          hdr[0] = 0x81;
          const masked = Buffer.alloc(data.length);
          for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
          try { socket.write(Buffer.concat([hdr, mask, masked])); } catch (e) {}
        },
        close() { try { socket.destroy(); } catch (e) {} }
      });
    });
    req.on('error', (e) => reject(new Error('WS connect fail: ' + e.message)));
    req.end();
  });
}

async function cdpConnect(wsUrl) {
  const u = new URL(wsUrl);
  const ws = await wsConnect(u.hostname, Number(u.port) || 80, u.pathname + u.search);
  let id = 0; const pending = new Map();
  const client = {
    send(method, params) {
      return new Promise((res2, rej2) => {
        const mid = ++id; pending.set(mid, { res: res2, rej: rej2 });
        ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
      });
    },
    close() { try { ws.close(); } catch (e) {} }
  };
  ws.onMessage((txt) => {
    let m; try { m = JSON.parse(txt); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(m.error.message || 'CDP error')); else p.res(m.result); }
  });
  ws.onClose(() => { for (const p of pending.values()) p.rej(new Error('browser closed')); pending.clear(); });
  return client;
}

async function evaluate(cdp, js) {
  const r = await cdp.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page error: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 120));
  return r.result && r.result.value;
}

async function ensureBrowser() {
  let ver = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version');
  if (ver) return { ok: true, reused: true };
  const bin = findBrowser();
  if (!bin) return { error: 'Chrome ya Edge nahi mila — pehle install karo (google.com/chrome)' };
  fs.mkdirSync(path.dirname(PROFILE_DIR), { recursive: true });
  spawn(bin, [
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE_DIR,
    '--no-first-run', '--no-default-browser-check', '--window-size=1250,850'
  ], { detached: false, stdio: 'ignore' });
  for (let i = 0; i < 20; i++) { await sleep(1000); ver = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); if (ver) break; }
  if (!ver) return { error: 'Browser start nahi hua — dobara try karo' };
  return { ok: true, browser: path.basename(bin) };
}

async function versionInfo() { return httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); }
async function listTabs() { const l = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json'); return Array.isArray(l) ? l : []; }

// naya tab banao (Chrome 111+ mein PUT chahiye) → target info return
function newTab(url) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: DEBUG_PORT, path: '/json/new?' + encodeURIComponent(url), method: 'PUT' }, (rr) => {
      let b = ''; rr.on('data', c => b += c); rr.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    r.setTimeout(8000, () => { r.destroy(); resolve(null); });
    r.on('error', () => resolve(null));
    r.end();
  });
}

async function activateTab(targetId) {
  try {
    const ver = await versionInfo();
    const cdp = await cdpConnect(ver.webSocketDebuggerUrl);
    await cdp.send('Target.activateTarget', { targetId });
    cdp.close();
    return true;
  } catch (e) { return false; }
}

async function closeTab(targetId) {
  try {
    const ver = await versionInfo();
    const cdp = await cdpConnect(ver.webSocketDebuggerUrl);
    await cdp.send('Target.closeTarget', { targetId });
    cdp.close();
    return true;
  } catch (e) { return false; }
}

function isYtTab(t) { return t && t.type === 'page' && (t.url || '').includes('youtube.com'); }
function isYtResultsTab(t) { return isYtTab(t) && (t.url || '').includes('search_query='); }

// ---- YouTube actions ----

// YouTube kholo: khula tab hai to usse focus, warna naya tab
async function ytOpen(url) {
  const up = await ensureBrowser();
  if (up.error) return up;
  const target = url || 'https://www.youtube.com';
  const tabs = await listTabs();
  const yt = tabs.find(isYtTab);
  if (yt && !url) {
    // pehle se khula → wahi tab pe le aao
    if (yt.webSocketDebuggerUrl) {
      try { const cdp = await cdpConnect(yt.webSocketDebuggerUrl); await evaluate(cdp, `location.href = ${JSON.stringify(target)}`); cdp.close(); } catch (e) {}
    }
    await activateTab(yt.id);
    return { ok: true, tab: 'existing', url: target };
  }
  const t = await newTab(target);
  if (!t) return { error: 'Tab nahi khul saka — dobara try karo' };
  await activateTab(t.id);
  return { ok: true, tab: 'new', url: target };
}

// Search: separate=true → naya tab, warna khule YouTube tab mein SAME tab search
async function ytSearch(query, opts) {
  const q = String(query || '').trim();
  if (!q) return { error: 'search keyword chahiye' };
  const separate = opts && opts.separate;
  const up = await ensureBrowser();
  if (up.error) return up;
  const resultsUrl = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
  const tabs = await listTabs();
  const yt = tabs.find(isYtTab);
  if (!separate && yt && yt.webSocketDebuggerUrl) {
    try {
      const cdp = await cdpConnect(yt.webSocketDebuggerUrl);
      await evaluate(cdp, `location.href = ${JSON.stringify(resultsUrl)}`);
      cdp.close();
      await activateTab(yt.id);
      return { ok: true, tab: 'same', query: q };
    } catch (e) { /* fallthrough → naya tab */ }
  }
  const t = await newTab(resultsUrl);
  if (!t) return { error: 'Tab nahi khul saka — dobara try karo' };
  await activateTab(t.id);
  return { ok: true, tab: separate ? 'separate' : 'new', query: q };
}

// khulī results page se nth video click karo (shared)
async function clickNth(cdp, idx) {
  for (let i = 0; i < 15; i++) {
    const cnt = await evaluate(cdp, `document.querySelectorAll('ytd-video-renderer a#thumbnail[href*="/watch"], ytd-grid-video-renderer a#thumbnail[href*="/watch"]').length`);
    if (cnt && cnt >= idx) break;
    await sleep(1000);
  }
  return evaluate(cdp, `(function(){
    var vids = document.querySelectorAll('ytd-video-renderer a#thumbnail[href*="/watch"], ytd-grid-video-renderer a#thumbnail[href*="/watch"]');
    if (!vids.length) return null;
    var el = vids[${idx} - 1];
    if (!el) return null;
    var title = '';
    try { title = el.closest('ytd-video-renderer, ytd-grid-video-renderer').querySelector('#video-title').innerText.trim(); } catch (e) {}
    el.click();
    return JSON.stringify({ title: title, index: ${idx}, total: vids.length });
  })()`);
}

// ABHI khuli results list mein se nth video play (search DOBARA nahi hota)
async function ytPlay(n) {
  const idx = Math.max(1, parseInt(n, 10) || 1);
  const up = await ensureBrowser();
  if (up.error) return up;
  const tabs = await listTabs();
  let res = tabs.find(isYtResultsTab);
  if (!res) res = tabs.find(isYtTab);
  if (!res) return { error: 'Koi YouTube results tab khuli nahi hai — pehle "search karo" bolo (e.g. "masihi geet search karo")' };
  if (!isYtResultsTab(res)) return { error: 'YouTube tab mein results nahi hain — pehle koi search karo, phir "nth video chalao" bolo' };
  const cdp = await cdpConnect(res.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable', {});
  const picked = await clickNth(cdp, idx);
  if (!picked) { cdp.close(); return { error: 'Results mein videos nahi mile — window mein check karo' }; }
  await sleep(4000);
  const playing = await evaluate(cdp, `(location.href.includes('/watch'))`);
  await activateTab(res.id);
  let info = {}; try { info = JSON.parse(picked); } catch (e) {}
  cdp.close();
  return { ok: true, playing: !!playing, picked_index: idx, title: info.title || '', total_results: info.total, note: playing ? 'video chal raha hai' : 'click hua but confirm nahi — window mein dekho' };
}

// search karke nth video play (n=3 → teesra)
async function ytSearchPlay(query, n, opts) {
  const idx = Math.max(1, parseInt(n, 10) || 3);
  const s = await ytSearch(query, opts);
  if (s.error) return s;
  await sleep(2500);
  const tabs = await listTabs();
  let res = tabs.find(t => isYtResultsTab(t) && decodeURIComponent(t.url || '').includes(encodeURIComponent(String(query).trim()).slice(0, 10)));
  if (!res) res = tabs.find(isYtResultsTab);
  if (!res) return { error: 'Results page load nahi hua — internet check karo' };
  const cdp = await cdpConnect(res.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable', {});
  const picked = await clickNth(cdp, idx);
  if (!picked) { cdp.close(); return { error: 'Search results nahi mile — internet check karo (YouTube login/consent screen aa sakta hai, window mein dekho)' }; }
  await sleep(4000);
  const playing = await evaluate(cdp, `(location.href.includes('/watch'))`);
  await activateTab(res.id);
  let info = {}; try { info = JSON.parse(picked); } catch (e) {}
  cdp.close();
  return { ok: true, playing: !!playing, query: String(query || '').trim(), picked_index: idx, title: info.title || '', total_results: info.total, tab: s.tab, note: playing ? 'video chal raha hai' : 'click hua but confirm nahi — window mein dekho' };
}

// YouTube tabs band (browser nahi, sirf YT tabs)
async function ytClose() {
  const tabs = await listTabs();
  const yt = tabs.filter(isYtTab);
  if (!yt.length) return { ok: true, closed: 0, note: 'koi YouTube tab khula nahi tha' };
  for (const t of yt) await closeTab(t.id);
  return { ok: true, closed: yt.length };
}

module.exports = { ytOpen, ytSearch, ytPlay, ytSearchPlay, ytClose };
