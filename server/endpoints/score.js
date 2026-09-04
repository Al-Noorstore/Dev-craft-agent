// ============================================
// LEAD SCORING - /api/score
// POST { "business_name", "category", "city", "rating", "reviews", "audit_score", "notes" }
// AI business ko 0-100 score deta hai + kyun behtar hai wo btata hai
// ============================================
const OpenAI = require('openai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const lead = req.body || {};
    if (!lead.business_name) return res.status(400).json({ error: 'business_name is required' });

    // Rule-based base score (free, no AI needed)
    let base = 50;
    if (lead.rating >= 4.5) base += 10;
    if (lead.reviews >= 500) base += 15;      // established business
    else if (lead.reviews >= 100) base += 8;
    if (lead.audit_score !== undefined) {
      if (lead.audit_score < 35) base += 20;  // bad website = best lead
      else if (lead.audit_score < 55) base += 12;
      else if (lead.audit_score > 80) base -= 20;
    }
    base = Math.max(0, Math.min(100, base));

    // If no OpenAI key, return rule-based only
    if (!process.env.OPENAI_API_KEY) {
      return res.json({ lead_score: base, method: 'rule_based',
        note: 'Set OPENAI_API_KEY for AI-powered detailed analysis' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a lead qualification expert for a web design agency. Score this business 0-100 as a prospect for website redesign services.
Return JSON: { "lead_score": number, "reason": "2-3 sentences why", "priority": "high|medium|low", "suggested_pitch": "one line pitch angle" }
Big established businesses (many reviews, high rating) with weak websites = high score. Small new businesses or ones with great websites = low score. Never guarantee sales.`
        },
        { role: 'user', content: JSON.stringify(lead) }
      ],
      max_tokens: 300
    });

    const ai = JSON.parse(completion.choices[0].message.content);
    res.json({ ...ai, rule_based_score: base, method: 'ai' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
