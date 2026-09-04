// ============================================
// SUPABASE AUTH HELPER - server/lib/auth.js
// Google login (Supabase Auth) ke saath:
// user ka access token verify karke REAL user id
// lata hai. Ab koi bhi user_id spoof nahi kar sakta
// - vault sirf verified Google user ke paas khulta hai.
// ============================================

// access_token verify karo => Supabase user id (real UUID) ya null
async function verifyUser(token) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY || !token) return null;
  try {
    const r = await fetch(SB_URL + '/auth/v1/user', {
      headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) return null;
    const u = await r.json();
    return (u && u.id) ? u.id : null;
  } catch (e) {
    return null; // Supabase down ya network issue => unverified
  }
}

// req se token lo (header ya body), verify karo
// returns: { verified: true, uid: '<uuid>' } ya { verified: false, uid: fallback }
async function resolveUser(req, fallbackUid) {
  const authHeader = (req.headers && req.headers.authorization) || '';
  const token = authHeader.replace(/^Bearer\s+/i, '') || (req.body && req.body.access_token) || null;
  const uid = await verifyUser(token);
  if (uid) return { verified: true, uid };
  return { verified: false, uid: String(fallbackUid || 'owner').trim() || 'owner' };
}

module.exports = { verifyUser, resolveUser };
