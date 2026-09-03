// ============================================
// AI IMAGE GENERATOR - /api/generate-image
// POST { "prompt": "modern hero image for construction website" }
// Website mockups, logos, hero images — OpenAI images API
// Requires: OPENAI_API_KEY (images alag se charge hoti hain ~$0.04/image)
// ============================================
const OpenAI = require('openai');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { prompt, size } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY env var missing' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const validSizes = ['1024x1024', '1792x1024', '1024x1792'];
    const img = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      size: validSizes.includes(size) ? size : '1792x1024'
    });

    res.json({ image_url: img.data[0].url, revised_prompt: img.data[0].revised_prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
