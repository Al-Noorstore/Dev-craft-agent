// ============================================
// GOOGLE ACCOUNT CONNECT - /api/google
// Solene-style: user apna Google account connect karta hai (Gmail, Calendar, Drive)
// Flow: Connect button -> Google consent -> callback -> tokens encrypted vault mein
// Aur: getGoogleAccessToken(uid) — hamesha fresh access token (auto-refresh)
//
// Env chahiye (Vercel pe): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
// Google Cloud Console > OAuth client mein redirect URI add karo:
//   https://dev-craft-agent.vercel.app/api/google/callback
// ============================================
const crypto = require('crypto');
const vault = require('../lib/credentials.js');

const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
].join(' ');

function creds() {
  return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
}

function redirectUri(req) {
  const host = (req.headers && req.headers.host) || 'dev-craft-agent.vercel.app';
  const proto = host.startsWith('localhost') ? 'http' : 'https';
  return proto + '://' + host + '/api/google/callback';
}

// state = uid.expiry.hmac — spoof-proof (vault secret se signed)
function stateSecret() {
  return process.env.CREDENTIALS_SECRET || process.env.SUPABASE_ANON_KEY || 'dev-craft-agent';
}
function signState(uid) {
  const exp = Date.now() + 10 * 60 * 1000;
  const base = uid + '.' + exp;
  const h = crypto.createHmac('sha256', stateSecret()).update(base).digest('hex').slice(0, 32);
  return base + '.' + h;
}
function verifyState(state) {
  try {
    const parts = String(state || '').split('.');
    const uid = parts[0], exp = parseInt(parts[1], 10), h = parts[2];
    const expect = crypto.createHmac('sha256', stateSecret()).update(uid + '.' + exp).digest('hex').slice(0, 32);
    if (h !== expect) return null;
    if (Date.now() > exp) return null;
    return uid;
  } catch (e) { return null; }
}

async function exchangeCode(code, ruri) {
  const c = creds();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: c.id, client_secret: c.secret,
      redirect_uri: ruri, grant_type: 'authorization_code',
    }).toString(),
  });
  return r.json();
}

async function refreshAccessToken(uid) {
  const c = creds();
  const refreshToken = await vault.getCredential('GOOGLE_REFRESH_TOKEN', uid);
  if (!refreshToken) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.id, client_secret: c.secret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }).toString(),
  });
  const d = await r.json();
  if (!d.access_token) return null;
  await vault.saveCredential('GOOGLE_ACCESS_TOKEN', d.access_token, 'Google access token (auto-refreshed)', uid);
  await vault.saveCredential('GOOGLE_TOKEN_EXPIRES_AT', String(Date.now() + (d.expires_in || 3600) * 1000), 'access token expiry ms', uid);
  return d.access_token;
}

// ---- Hamesha-fresh access token (chat brain isko use karta hai) ----
async function getGoogleAccessToken(uid) {
  uid = uid || 'owner';
  const at = await vault.getCredential('GOOGLE_ACCESS_TOKEN', uid);
  const exp = parseInt((await vault.getCredential('GOOGLE_TOKEN_EXPIRES_AT', uid)) || '0', 10);
  if (at && exp > Date.now() + 60000) return at;
  return refreshAccessToken(uid);
}

async function connectedStatus(uid) {
  uid = uid || 'owner';
  const rt = await vault.getCredential('GOOGLE_REFRESH_TOKEN', uid);
  const email = await vault.getCredential('GOOGLE_EMAIL', uid);
  return { connected: !!rt, email: email || null };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  // ---------- GOOGLE CALLBACK (browser redirect) ----------
  if (req.method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const err = url.searchParams.get('error');
    if (err) return res.writeHead(302, { Location: '/?google=error' }).end();
    const uid = verifyState(state);
    if (!code || !uid) return res.writeHead(302, { Location: '/?google=error' }).end();
    try {
      const d = await exchangeCode(code, redirectUri(req));
      if (!d.access_token) return res.writeHead(302, { Location: '/?google=error' }).end();
      await vault.saveCredential('GOOGLE_ACCESS_TOKEN', d.access_token, 'Google access token', uid);
      if (d.refresh_token) await vault.saveCredential('GOOGLE_REFRESH_TOKEN', d.refresh_token, 'Google refresh token (permanent)', uid);
      await vault.saveCredential('GOOGLE_TOKEN_EXPIRES_AT', String(Date.now() + (d.expires_in || 3600) * 1000), 'access token expiry ms', uid);
      let email = null;
      try {
        const u = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: 'Bearer ' + d.access_token } });
        const ud = await u.json();
        email = ud.email || null;
      } catch (e) {}
      if (email) await vault.saveCredential('GOOGLE_EMAIL', email, 'connected Google account', uid);
      return res.writeHead(302, { Location: '/?google=connected' }).end();
    } catch (e) {
      return res.writeHead(302, { Location: '/?google=error' }).end();
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const { action, user_id } = req.body || {};
  const uid = user_id || 'owner';
  const c = creds();
  if (!c.id || !c.secret) {
    return res.status(500).json({
      error: 'Google OAuth not configured',
      setup_help: 'Vercel env vars set karo: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. Google Cloud Console > APIs & Services > Credentials > OAuth Client ID (Web application). Redirect URI: ' + redirectUri(req),
    });
  }

  try {
    if (action === 'connect') {
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: c.id,
        redirect_uri: redirectUri(req),
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: signState(uid),
      }).toString();
      return res.status(200).json({ url: authUrl });
    }

    if (action === 'status') {
      return res.status(200).json(await connectedStatus(uid));
    }

    if (action === 'disconnect') {
      for (const n of ['GOOGLE_REFRESH_TOKEN', 'GOOGLE_ACCESS_TOKEN', 'GOOGLE_TOKEN_EXPIRES_AT', 'GOOGLE_EMAIL']) {
        await vault.deleteCredential(n, uid).catch(() => {});
      }
      return res.status(200).json({ ok: true, disconnected: true });
    }

    return res.status(400).json({ error: 'action: connect | status | disconnect' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

module.exports = handler;
module.exports.getGoogleAccessToken = getGoogleAccessToken;
module.exports.connectedStatus = connectedStatus;
