// ============================================
// BUSINESS SEARCH - /api/search
// POST { "query": "restaurants Tulsa", "location": "Tulsa, OK" }
// Uses Google Places API (requires GOOGLE_MAPS_API_KEY)
// Returns businesses with name, rating, reviews, website, phone
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { query, location } = req.body || {};
    const KEY = process.env.GOOGLE_MAPS_API_KEY;
    if (!KEY) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY env var missing (set it in Vercel)' });

    // 1. Text search
    const searchText = location ? `${query} in ${location}` : query;
    const searchUrl =
      'https://maps.googleapis.com/maps/api/place/textsearch/json?query=' +
      encodeURIComponent(searchText) + '&key=' + KEY;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const results = (searchData.results || []).slice(0, 10);

    // 2. Get details (website + phone) for each
    const detailed = await Promise.all(
      results.map(async (r) => {
        const detUrl =
          'https://maps.googleapis.com/maps/api/place/details/json?place_id=' +
          r.place_id +
          '&fields=name,rating,user_ratings_total,formatted_phone_number,website,formatted_address&key=' +
          KEY;
        const detRes = await fetch(detUrl);
        const det = (await detRes.json()).result || {};
        return {
          name: det.name || r.name,
          rating: det.rating || null,
          reviews: det.user_ratings_total || null,
          address: det.formatted_address || null,
          phone: det.formatted_phone_number || null,
          website: det.website || null, // null = NO website = best lead!
          maps_url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(det.name || r.name)
        };
      })
    );

    // Sort: businesses WITHOUT a website first (best prospects)
    detailed.sort((a, b) => (a.website ? 1 : 0) - (b.website ? 1 : 0));

    res.json({ results: detailed, found: detailed.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
