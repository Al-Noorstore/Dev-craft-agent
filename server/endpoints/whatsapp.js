// ============================================
// WHATSAPP BOT WEBHOOK - /api/whatsapp
// GET  => webhook verification (Meta calls this once during setup)
// POST => receives messages from WhatsApp users, sends AI reply back
// Requires (Meta Cloud API): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
// ============================================
const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are "Dev Craft Agent" - a friendly AI assistant for Dev Craft Studio (web design agency).
Reply in the same language the user writes in (English, Urdu, or Roman Urdu).
Be short and helpful. You help with: finding business leads, drafting outreach emails, website questions.
Never guarantee sales or revenue. Never send spam content.`;

// --- Meta webhook verification ---
exports.default = async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  if (req.method !== 'POST') return res.status(405).end();

  // --- Incoming message handling ---
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') return res.sendStatus(200);

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const messages = (change.value && change.value.messages) || [];
        for (const msg of messages) {
          if (msg.type !== 'text') continue;
          const from = msg.from; // sender phone number
          const text = msg.text.body;

          // Generate AI reply
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: text }
            ],
            max_tokens: 500
          });
          const reply = completion.choices[0].message.content;

          // Send reply back via WhatsApp Cloud API
          await fetch(
            'https://graph.facebook.com/v19.0/' + process.env.WHATSAPP_PHONE_NUMBER_ID + '/messages',
            {
              method: 'POST',
              headers: {
                Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: from,
                type: 'text',
                text: { body: reply }
              })
            }
          );
        }
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    res.sendStatus(200); // always 200 so Meta doesn't retry forever
  }
};
