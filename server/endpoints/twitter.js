// ============================================
// TWITTER/X LEAD SEARCH - /api/twitter
// POST { "query": "need a website developer" }
// X (Twitter) pe businesses dhundhta hai jo website services dhundh rahe hain
// Requires: TWITTER_BEARER_TOKEN - https://developer.twitter.com (Basic $100/mo needed for search!
// NOTE: X API free tier mein search NAHI milta — sirf Basic+ plan pe.
// Free alternative: LinkedIn/Google manually, ya /api/search use karo)
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { query, max_results } = req.body || {};
    if (!query) return res.status(400).json({ error: 'query required, e.g. "need a web designer"' });
    if (!process.env.TWITTER_BEARER_TOKEN) {
      return res.status(500).json({
        error: 'Twitter not configured',
        setup_help: 'developer.x.com > app banao > Bearer Token lo. DHYAAN: search API ke liye Basic plan ($100/month) chahiye — free tier mein search nahi milta!'
      });
    }

    const url = 'https://api.twitter.com/2/tweets/search/recent?query=' +
      encodeURIComponent(query) +
      '&max_results=' + Math.min(max_results || 10, 25) +
      '&tweet.fields=created_at,author_id,public_metrics';

    const twRes = await fetch(url, {
      headers: { Authorization: 'Bearer ' + process.env.TWITTER_BEARER_TOKEN }
    });
    const data = await twRes.json();
    if (!twRes.ok) throw new Error(data.title ? (data.title + ': ' + (data.detail || '')) : 'Twitter error');

    const tweets = (data.data || []).map(t => ({
      id: t.id,
      text: t.text,
      author: 'https://twitter.com/i/web/status/' + t.id,
      likes: t.public_metrics ? t.public_metrics.like_count : 0,
      when: t.created_at
    }));

    res.json({ count: tweets.length, tweets, tip: 'Is tweet walon ko politely DM karo — kabhi spam mat karo.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
