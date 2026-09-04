// ============================================
// PUBLIC CONFIG - /api/config
// Frontend ko batata hai ke Supabase (Google auth)
// on hai ya nahi. Anon key public hai by design -
// ye login ke liye hai, data access RLS se control hota hai.
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });
  return res.status(200).json({
    supabase_url: process.env.SUPABASE_URL || null,
    supabase_anon_key: process.env.SUPABASE_ANON_KEY || null,
    google_auth: !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
  });
};
