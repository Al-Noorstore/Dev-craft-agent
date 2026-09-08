// ============================================
// BROWSER AUTOMATION (desktop) — browser.js
// Zero npm deps (Node 18+): system Chrome/Edge +
// CDP + apna mini WebSocket client. WhatsApp Web
// wale browser se hi share karta hai (agar chalu
// hai to same window, warna khud launch).
// ytSearchPlay(query, n) → nth video click.
// ============================================
const { spawn, exec } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEBUG_PORT = 9333;
const PROFILE_DIR = path.join(os.homedir(), '.dev-craft', 'wa-profile');

const st = { proc: null, spawned: false };

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

// browser chalu hai (kisi ne bhi launch kiya, e.g. whatsapp web) to reuse karo
async function ensureBrowser() {
  let ver = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version');
  if (ver) return { reused: true };
  const bin = findBrowser();
  if (!bin) return { error: 'Chrome ya Edge nahi mila — pehle install karo (google.com/chrome)' };
  fs.mkdirSync(path.dirname(PROFILE_DIR), { recursive: true });
  st.proc = spawn(bin, [
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE_DIR,
    '--no-first-run', '--no-default-browser-check', '--window-size=1250,850'
  ], { detached: false, stdio: 'ignore' });
  st.spawned = true;
  for (let i = 0; i < 20; i++) { await sleep(1000); ver = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); if (ver) break; }
  if (!ver) return { error: 'Browser start nahi hua — dobara try karo' };
  return { ok: true, browser: path.basename(bin) };
}

async function findOrCreateTab(urlPart) {
  for (let i = 0; i < 5; i++) {
    const list = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json');
    let t = (list || []).find(t => (t.url || '').includes(urlPart) && t.type === 'page');
    if (t) return t;
    if (i === 4) {
      // naya tab banao (Chrome >= 111 mein PUT chahiye)
      try {
        await new Promise((res3, rej3) => {
          const r2 = http.request({ host: '127.0.0.1', port: DEBUG_PORT, path: '/json/new?about:blank', method: 'PUT' }, (rr) => { rr.resume(); rr.on('end', res3); });
          r2.on('error', rej3); r2.end();
        });
      } catch (e) {}
    }
    await sleep(1000);
  }
  return null;
}

// YouTube search karke nth video play karo (n=3 → teesra)
async function ytSearchPlay(query, n) {
  const q = String(query || '').trim();
  const idx = Math.max(1, parseInt(n, 10) || 3);
  if (!q) return { error: 'search keyword chahiye' };
  const up = await ensureBrowser();
  if (up.error) return up;
  const cdp = await cdpConnect((await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version')).webSocketDebuggerUrl);
  await cdp.send('Runtime.enable', {});
  // current page ya naya tab — YouTube results pe le jao
  await evaluate(cdp, `location.href = 'https://www.youtube.com/results?search_query=' + ${JSON.stringify(encodeURIComponent(q))}`);
  await sleep(3000);
  // videos load hone tak wait
  for (let i = 0; i < 15; i++) {
    const cnt = await evaluate(cdp, `document.querySelectorAll('ytd-video-renderer a#thumbnail[href*="/watch"], ytd-grid-video-renderer a#thumbnail[href*="/watch"]').length`);
    if (cnt && cnt >= idx) break;
    await sleep(1000);
  }
  // nth video click
  const picked = await evaluate(cdp, `(function(){
    var vids = document.querySelectorAll('ytd-video-renderer a#thumbnail[href*="/watch"], ytd-grid-video-renderer a#thumbnail[href*="/watch"]');
    if (!vids.length) return null;
    var el = vids[${idx} - 1];
    if (!el) return null;
    var title = '';
    try { title = el.closest('ytd-video-renderer, ytd-grid-video-renderer').querySelector('#video-title').innerText.trim(); } catch (e) {}
    el.click();
    return JSON.stringify({ title: title, index: ${idx}, total: vids.length });
  })()`);
  if (!picked) return { error: 'Search results nahi mile — internet check karo (YouTube login/consent screen aa sakta hai, window mein dekho)' };
  await sleep(4000);
  const playing = await evaluate(cdp, `(location.href.includes('/watch'))`);
  let info = {}; try { info = JSON.parse(picked); } catch (e) {}
  cdp.close();
  return { ok: true, playing: !!playing, query: q, picked_index: idx, title: info.title || '', total_results: info.total, note: playing ? 'video chal raha hai' : 'click hua but confirm nahi — window mein dekho' };
}

module.exports = { ytSearchPlay };
