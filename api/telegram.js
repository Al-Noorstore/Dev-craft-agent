// ============================================
// TELEGRAM BOT - /api/telegram
// POST => Telegram se aaya message receive karke AI reply bhejta hai
// (Har user ka apna alag chat — WhatsApp jaisa bilkul!)
// Requires: TELEGRAM_BOT_TOKEN - @BotFather se milega (free, 2 minute setup)
//   1. Telegram mein @BotFather ko "/newbot" likho
//   2. Token copy karo -> TELEGRAM_BOT_TOKEN set karo
//   3. Webhook set karo (ek dafa):
//      https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-project.vercel.app/api/telegram
// ============================================
const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are "Dev Craft Agent" - a friendly AI assistant for Dev Craft Studio (web design agency).
Reply in the same language the user writes in (English, Urdu, or Roman Urdu).
Be short and helpful. You help with: websites, pricing, proposals, questions about the agency's services.
Never guarantee sales or revenue. Never send spam content.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return res.sendStatus(200);

    const msg = body.message;
    if (!msg || !msg.text) return res.sendStatus(200);

    const chatId = msg.chat.id;      // har user ka apna unique chat id
    const userText = msg.text;

    // AI reply
    let reply;
    if (process.env.OPENAI_API_KEY) {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText }
        ],
        max_tokens: 500
      });
      reply = completion.choices[0].message.content;
    } else {
      reply = 'AI brain not configured. Vercel mein OPENAI_API_KEY set karo.';
    }

    // Reply bhejo
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply
      })
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('Telegram webhook error:', err);
    res.sendStatus(200);
  }
};
