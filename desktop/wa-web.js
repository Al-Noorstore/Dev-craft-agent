// ============================================
// WHATSAPP WEB AUTOMATION (desktop) — wa-web.js
// Zero npm deps, Node 18+: system Chrome/Edge +
// CDP apne mini WebSocket client pe. Persistent
// profile (~/.dev-craft/wa-profile) => QR ek BAAR
// scan, uske baad session yaad rehta hai.
// action('connect'|'status'|'disconnect'),
// openChat(name), send(text), sendTo(name, text)
// ============================================
const { spawn, exec } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEBUG_PORT = 9333;
const PROFILE_DIR = path.join(os.homedir(), '.dev-craft', 'wa-profile');

const st = { proc: null, cdp: null, ready: false, lastChat: null };

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
            // ping → pong (masked, empty payload)
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
          hdr[0] = 0x81; // FIN + text
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

// ---- CDP client (mini ws pe) ----
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
  ws.onClose(() => { for (const p of pending.values()) p.rej(new Error('browser closed')); pending.clear(); if (st.cdp === client) { st.cdp = null; st.ready = false; } });
  return client;
}

async function evaluate(js) {
  if (!st.cdp) throw new Error('WhatsApp Web connected nahi hai');
  const r = await st.cdp.send('Runtime.evaluate', { expression: js, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page error: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').slice(0, 120));
  return r.result && r.result.value;
}

async function pressEnter() {
  const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 };
  await st.cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' });
  await st.cdp.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

async function pageStatus() {
  if (!st.ready || !st.cdp) return { running: false };
  try {
    const v = await evaluate(`(function(){
      var search = document.querySelector('div[contenteditable="true"][data-tab="3"]');
      var comp = document.querySelector('#main footer div[contenteditable="true"]');
      var qr = document.querySelector('div[data-ref] canvas, canvas[aria-label*="QR" i]');
      if (search || comp) return 'logged_in';
      if (qr) return 'need_qr';
      return 'loading';
    })()`);
    if (v === 'logged_in') return { running: true, logged_in: true, lastChat: st.lastChat };
    if (v === 'need_qr') return { running: true, logged_in: false, qr: true, note: 'WhatsApp Web window mein QR scan karo (ek baar — uske baad yaad rehta hai)' };
    return { running: true, logged_in: false, note: 'page load ho raha hai — 5 sec baad status dobara check karo' };
  } catch (e) { return { running: false, error: String(e.message || e) }; }
}

// ---- public commands ----
async function action(act) {
  if (act === 'status') return await pageStatus();
  if (act === 'disconnect') {
    try { if (st.proc && process.platform === 'win32') exec('taskkill /PID ' + st.proc.pid + ' /F /T'); else if (st.proc) st.proc.kill('SIGKILL'); } catch (e) {}
    try { if (st.cdp) st.cdp.close(); } catch (e) {}
    st.proc = null; st.cdp = null; st.ready = false; st.lastChat = null;
    return { ok: true, closed: true };
  }
  // connect
  if (st.ready && st.cdp) { const p = await pageStatus(); if (p.running) return { ok: true, already: true, ...p }; }
  const bin = findBrowser();
  if (!bin) return { error: 'Chrome ya Edge nahi mila — pehle install karo (google.com/chrome)' };
  fs.mkdirSync(path.dirname(PROFILE_DIR), { recursive: true });
  st.proc = spawn(bin, [
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + PROFILE_DIR,
    '--no-first-run', '--no-default-browser-check', '--window-size=1250,850',
    'https://web.whatsapp.com'
  ], { detached: false, stdio: 'ignore' });
  st.proc.on('exit', () => { st.proc = null; st.cdp = null; st.ready = false; });
  // debug port wait (max 20s)
  let up = null;
  for (let i = 0; i < 20; i++) { await sleep(1000); up = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json/version'); if (up) break; }
  if (!up) return { error: 'Browser start hua lekin debug port nahi khula — dobara try karo ya Chrome/Edge check karo' };
  // WA tab dhoondo
  let target = null;
  for (let i = 0; i < 15; i++) {
    const list = await httpJson('http://127.0.0.1:' + DEBUG_PORT + '/json');
    target = (list || []).find(t => (t.url || '').includes('web.whatsapp.com') && t.type === 'page');
    if (target) break;
    await sleep(1000);
  }
  if (!target) return { error: 'WhatsApp Web tab nahi khul saki — internet check karo' };
  st.cdp = await cdpConnect(target.webSocketDebuggerUrl);
  await st.cdp.send('Runtime.enable', {});
  st.ready = true;
  await sleep(2000);
  const p = await pageStatus();
  return { ok: true, browser: path.basename(bin), ...p };
}

async function openChat(name) {
  const nm = String(name || '').trim();
  if (!nm) return { error: 'naam chahiye, e.g. Shahzad' };
  const p = await pageStatus();
  if (!p.running) return { error: 'WhatsApp Web connected nahi — pehle "WhatsApp Web kholo" bolo' };
  if (!p.logged_in) return { error: 'Pehle WhatsApp window mein QR scan karo (ek baar), phir dobara bolo', need_qr: true };
  // search box click + focus
  const clicked = await evaluate(`(function(){
    var s = document.querySelector('div[contenteditable="true"][data-tab="3"]');
    if (!s) return 'no_search';
    s.focus(); s.click(); return 'ok';
  })()`);
  if (clicked !== 'ok') return { error: 'WhatsApp search box nahi mila — window mein manually check karo ke login complete hai' };
  await evaluate(`document.execCommand('selectAll')`);
  await st.cdp.send('Input.insertText', { text: nm });
  await sleep(1800); // results
  await pressEnter();
  await sleep(1200);
  const opened = await evaluate(`(function(){
    var f = document.querySelector('#main footer div[contenteditable="true"]');
    var h = document.querySelector('#main header');
    return JSON.stringify({ open: !!f, title: h ? h.innerText.slice(0, 60) : '' });
  })()`);
  let info = {}; try { info = JSON.parse(opened); } catch (e) { info = { open: false }; }
  if (!info.open) return { error: '"' + nm + '" chat nahi khuli — naam check karo (exact naam likho jaisa WhatsApp mein hai)' };
  st.lastChat = nm;
  return { ok: true, opened: info.title || nm };
}

async function send(text) {
  const msg = String(text || '');
  if (!msg) return { error: 'message text chahiye' };
  const p = await pageStatus();
  if (!p.running) return { error: 'WhatsApp Web connected nahi — pehle "WhatsApp Web kholo" bolo' };
  if (!p.logged_in) return { error: 'Pehle WhatsApp window mein QR scan karo', need_qr: true };
  const focused = await evaluate(`(function(){
    var f = document.querySelector('#main footer div[contenteditable="true"]');
    if (!f) return 'no';
    f.focus(); return 'ok';
  })()`);
  if (focused !== 'ok') return { error: 'koi chat open nahi hai — pehle naam ki chat kholo' };
  await st.cdp.send('Input.insertText', { text: msg });
  await sleep(400);
  await pressEnter();
  await sleep(700);
  const sent = await evaluate(`(function(){
    var f = document.querySelector('#main footer div[contenteditable="true"]');
    return (f && f.innerText.trim() === '') ? 'sent' : 'check';
  })()`);
  return { ok: true, sent: sent === 'sent' || true, to: st.lastChat, note: sent === 'check' ? 'send hua lagta hai — window mein confirm karo' : '' };
}

// WhatsApp Web: apna bheja hua message delete karo
// which: 1 = last sent, 2 = second-last sent... | mode: 'everyone' | 'me'
async function deleteMsg(name, opts) {
  opts = opts || {};
  const which = Math.max(1, parseInt(opts.which, 10) || 1);
  const mode = opts.mode === 'me' ? 'me' : 'everyone';
  const p = await pageStatus();
  if (!p.running) return { error: 'WhatsApp Web connected nahi — pehle "WhatsApp Web kholo" bolo' };
  if (!p.logged_in) return { error: 'Pehle WhatsApp window mein QR scan karo', need_qr: true };
  if (name) { const o = await openChat(name); if (o.error) return o; }
  // target outgoing message ka rect
  const rect = await evaluate(`(function(){
    var outs = document.querySelectorAll('#main .message-out');
    if (!outs.length) return null;
    var el = outs[outs.length - ${which}];
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, total: outs.length });
  })()`);
  if (!rect) return { error: 'Koi sent message nahi mila (sirf TUMHARE bheje messages delete ho sakte hain)' };
  let box = {}; try { box = JSON.parse(rect); } catch (e) { return { error: 'message locate fail' }; }
  // hover → chevron reveal karo
  await st.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + box.w / 2, y: box.y + box.h / 2, button: 'none', buttons: 0 });
  await sleep(600);
  // chevron button ke coordinates
  const chev = await evaluate(`(function(){
    var outs = document.querySelectorAll('#main .message-out');
    var el = outs[outs.length - ${which}];
    if (!el) return null;
    var b = el.querySelector('[data-icon="chevron-down"], [data-icon="down"], [data-icon="down-context-menu"]');
    if (!b) return null;
    var r = b.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`);
  let cxy = null; try { cxy = chev ? JSON.parse(chev) : null; } catch (e) {}
  let cx, cy;
  if (cxy) { cx = cxy.x; cy = cxy.y; }
  else { cx = box.x + box.w - 18; cy = box.y + box.h - 14; } // fallback: bubble ke bottom-right corner
  await st.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none', buttons: 0 });
  await sleep(300);
  await st.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', buttons: 1, clickCount: 1 });
  await st.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(900);
  // menu item "Delete message"
  const clickedDel = await evaluate(`(function(){
    var nodes = document.querySelectorAll('div, span, li, [role="menuitem"], [role="button"]');
    var rx = /delete|مٹا|حذف|پیغام مٹ/i;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].children.length > 0) continue; // leaf nodes only
      var t = (nodes[i].innerText || '').trim();
      if (t && t.length < 40 && rx.test(t)) { nodes[i].click(); return t; }
    }
    return null;
  })()`);
  if (!clickedDel) return { error: 'Delete menu nahi mila — WhatsApp Web window mein UI check karo (delete option sirf recent messages pe hota hai)' };
  await sleep(1200);
  // dialog: "Delete for everyone" ya "Delete for me"
  const picked = await evaluate(`(function(){
    var nodes = document.querySelectorAll('button, div, span, [role="button"]');
    var del = /delete|مٹا|حذف/i;
    var every = /everyone|سب کے لیے|سب کیلئے|ہر ایک/i;
    var me = /for me|مجھ|صرف مجھ/i;
    var cands = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].children.length > 0) continue;
      var t = (nodes[i].innerText || '').trim();
      if (t && t.length < 35 && del.test(t)) cands.push({ el: nodes[i], t: t });
    }
    ${mode === 'everyone' ? `
    for (var j = 0; j < cands.length; j++) { if (every.test(cands[j].t)) { cands[j].el.click(); return cands[j].t; } }
    return null;` : `
    for (var k = 0; k < cands.length; k++) { if (me.test(cands[k].t)) { cands[k].el.click(); return cands[k].t; } }
    if (cands.length === 1) { cands[0].el.click(); return cands[0].t; }
    return null;`}
  })()`);
  if (!picked) return { error: mode === 'everyone' ? '"Delete for everyone" button nahi mila — message bahut purana ho sakta hai (WhatsApp sirf recent messages sab ke liye delete karne deta hai). Window mein manually check karo.' : '"Delete for me" button nahi mila — window mein manually check karo.' };
  await sleep(1000);
  // verify: count kam hua?
  let after = null;
  try { after = await evaluate(`document.querySelectorAll('#main .message-out').length`); } catch (e) {}
  return { ok: true, deleted: true, mode: mode === 'everyone' ? 'sab ke liye (delete for everyone)' : 'sirf mujhe (delete for me)', which: which, to: st.lastChat, count_before: box.total, count_after: after };
}

async function sendTo(name, text) {
  const o = await openChat(name);
  if (o.error) return o;
  return await send(text);
}

module.exports = { action, openChat, send, sendTo, deleteMsg };
