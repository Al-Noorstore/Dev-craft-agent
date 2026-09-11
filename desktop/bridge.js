// Dev Craft Bridge — PC side (Termux optional, direct bhi chalega)
// Usage: node bridge.js
// Requirements: node 18+ (built-in fetch). Windows/Linux/Mac sab pe chalta hai.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const CLOUD_URL = process.env.CLOUD_URL || 'https://dev-craft-agent.vercel.app'; // apna URL
const POLL_MS = 4000;
const DEVICE_ID = 'pc-' + os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);

let pairingCode = null, paired = false, deviceId = DEVICE_ID;

function log(msg) { console.log('[' + new Date().toLocaleTimeString() + '] ' + msg); }

async function cloudApi(pathname, body) {
  const res = await fetch(CLOUD_URL + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, pairing_code: pairingCode, ...body })
  });
  return res.json();
}

function runShell(cmd, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: ((stdout || '') + (stderr || '')).slice(0, 8000) });
    });
  });
}

function fingerprint() {
  const info = {
    device_id: deviceId,
    platform: os.platform(),
    hostname: os.hostname(),
    user: os.userInfo().username,
    cpus: os.cpus().length,
    ram_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    arch: os.arch(),
    uptime: os.uptime(),
  };
  try { info.cwd = process.cwd(); info.node = process.version; } catch (e) {}
  return info;
}

// ---- simple tool runner (same spirit as desktop app) ----
async function runTool(name, args) {
  const home = os.homedir();
  switch (name) {
    case 'system_info': return fingerprint();
    case 'run_command': {
      const r = await runShell(args.command, args.timeout_ms || 60_000);
      return r;
    }
    case 'file_list': {
      try {
        const dir = args.path || home;
        return { files: fs.readdirSync(dir).slice(0, 500) };
      } catch (e) { return { error: e.message }; }
    }
    case 'file_read': {
      try { return { content: fs.readFileSync(args.path, 'utf8').slice(0, 100_000) }; }
      catch (e) { return { error: e.message }; }
    }
    case 'file_write': {
      try {
        fs.mkdirSync(path.dirname(args.path), { recursive: true });
        fs.writeFileSync(args.path, args.content || '', 'utf8');
        return { ok: true, saved: args.path };
      } catch (e) { return { error: e.message }; }
    }
    case 'file_delete': {
      try {
        const st = fs.statSync(args.path);
        if (st.isDirectory()) fs.rmSync(args.path, { recursive: true, force: true });
        else fs.unlinkSync(args.path);
        return { ok: true, deleted: args.path };
      } catch (e) { return { error: e.message }; }
    }
    case 'screenshot': {
      // needs scrot (linux) or nircmd (windows) — return tip if missing
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'nircmd savescreenshot C:\\dcd_shot.png' : 'scrot /tmp/dcd_shot.png';
      const r = await runShell(cmd, 20_000);
      if (!r.ok) return { error: 'screenshot tool missing', tip: isWin ? 'nircmd install karo' : 'sudo apt install scrot' };
      const p = isWin ? 'C:\\dcd_shot.png' : '/tmp/dcd_shot.png';
      return { ok: true, file: p };
    }
    default: return { error: 'unknown tool: ' + name };
  }
}

// ---- main loop ----
async function startPairing() {
  log('Dev Craft Bridge — PC agent started (device: ' + deviceId + ')');
  const r = await cloudApi('/api/bridge/hello', fingerprint());
  if (r.pairing_code) {
    pairingCode = r.pairing_code;
    log('PAIRING CODE: ' + pairingCode + '  ← is ko mobile app ya web (Settings) mein dalo');
    log('Is window ko khula rakho — agent PC se juda rahega.');
  } else {
    log('Cloud se jawab nahi mila: ' + JSON.stringify(r).slice(0, 200));
    log('Internet check karo, phir dobara chalao.');
    process.exit(1);
  }
}

async function pollJobs() {
  const r = await cloudApi('/api/bridge/poll', { busy: false });
  if (r.job) {
    log('Job mila: ' + r.job.tool + ' ' + JSON.stringify(r.job.args || {}).slice(0, 120));
    let result, error = null;
    try { result = await runTool(r.job.tool, r.job.args || {}); }
    catch (e) { error = e.message; result = null; }
    const done = await cloudApi('/api/bridge/done', { job_id: r.job.id, result, error });
    log('Job complete: ' + (done.ok ? 'OK' : JSON.stringify(done).slice(0, 150)));
  }
}

async function main() {
  await startPairing();
  paired = true;
  // heartbeat + job poll loop
  setInterval(async () => {
    if (!paired) return;
    try { await pollJobs(); }
    catch (e) { /* network hiccup — retry next tick */ }
  }, POLL_MS);
  log('Bridge live. Jobs ka intezar... (band karne ke liye Ctrl+C)');
}

process.on('SIGINT', () => { log('Bridge band.'); process.exit(0); });
main().catch(e => { log('Fatal: ' + e.message); process.exit(1); });
