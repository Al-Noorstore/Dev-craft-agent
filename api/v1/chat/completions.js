// ============================================
// OPENAI-COMPATIBLE ENDPOINT - /api/v1/chat/completions
// Ye VS Code ke AI extensions (Continue, Cline) ke saath chalta hai!
// Setup in VS Code extension settings:
//   Base URL: https://your-project.vercel.app/api/v1
//   API Key: your OPENAI_API_KEY value
// ============================================
const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are "Dev Craft Agent" - an AI coding + agency assistant for Dev Craft Studio (web design agency).
Help with: HTML/CSS/JS/React code, website building, client projects, proposals, pricing.
Reply in the same language the user writes in. Be concise and practical.`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Use POST' } });

  try {
    const body = req.body || {};
    const messages = body.messages || [];
    if (!messages.length) {
      return res.status(400).json({ error: { message: 'messages required' } });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY env var missing' } });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: body.max_tokens || 1500,
      temperature: body.temperature ?? 0.7
    });

    // OpenAI ka exact response format (extensions isi ke liye pochte hain)
    res.json({
      id: completion.id,
      object: 'chat.completion',
      created: completion.created,
      model: completion.model,
      choices: completion.choices,
      usage: completion.usage
    });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
};
