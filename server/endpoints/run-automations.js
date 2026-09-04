// ============================================
// RUN AUTOMATIONS - /api/run-automations  (Vercel cron: roz 9 AM PKT / 4:00 UTC)
// Jo automations user ne /api/automations se save kiye hain,
// ye unke prompts khud chalata hai (agent brain + tools ke saath)
// aur combined digest email karta hai.
// Chalane ke liye: OPENAI_API_KEY + Supabase (automations table) + Gmail (optional email)
// ============================================
const OpenAI = require('openai');
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  if (res && res.setHeader) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  // Optional CRON_SECRET check (Vercel sends: Authorization: Bearer $CRON_SECRET)
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = (req.headers && (req.headers.authorization || '')) || '';
    if (auth !== 'Bearer ' + secret) {
      if (res) return res.status(401).json({ error: 'Unauthorized' });
      return { error: 'Unauthorized' };
    }
  }

  const chatBrain = require('./chat.js'); // exports: SYSTEM_PROMPT, TOOLS, runTool

  const results = [];
  let automations = [];

  // 1. Fetch automations from Supabase
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY;
  if (SB_URL && SB_KEY) {
    try {
      const listRes = await fetch(SB_URL + '/rest/v1/automations?select=*&active=eq.true', {
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      if (listRes.ok) automations = await listRes.json();
    } catch (e) { /* table missing etc. */ }
  }

  // 2. Har active automation ka prompt agent brain se chalao
  if (process.env.OPENAI_API_KEY && automations.length) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    for (const a of automations) {
      try {
        const messages = [
          { role: 'system', content: chatBrain.SYSTEM_PROMPT + '\n\n[CONTEXT: Ye ek SCHEDULED AUTOMATION run hai (user nahi baat kar raha). Prompt user ne pehle save kiya tha - aap ise silently execute karo, tools use karo, aur result ka concise summary do. Urdu/Roman Urdu mix theek hai.]' },
          { role: 'user', content: a.prompt }
        ];
        const steps = [];
        let reply = '';
        for (let round = 0; round < 4; round++) {
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages, tools: chatBrain.TOOLS, max_tokens: 1500,
          });
          const msg = completion.choices[0].message;
          if (msg.tool_calls && msg.tool_calls.length) {
            messages.push(msg);
            for (const tc of msg.tool_calls) {
              let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
              const result = await chatBrain.runTool(tc.function.name, args, steps);
              messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 3500) });
            }
            continue;
          }
          reply = msg.content || '';
          break;
        }
        if (!reply) reply = 'Automation chal gayi (steps upar) 👆';
        results.push({ name: a.name, prompt: a.prompt, success: true, reply, steps: steps.map(s => (s.title || '') + (s.status === 'error' ? ' [ERROR]' : '') + (s.detail ? ' - ' + s.detail : '')) });

        // last_run update
        try {
          await fetch(SB_URL + '/rest/v1/automations?id=eq.' + encodeURIComponent(a.id), {
            method: 'PATCH',
            headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ last_run: new Date().toISOString() })
          });
        } catch (e) { /* non-fatal */ }
      } catch (err) {
        results.push({ name: a.name, prompt: a.prompt, success: false, reply: 'Error: ' + err.message });
      }
    }
  }

  // 3. Daily report bhi chala do (existing logic reuse)
  let reportResult = null;
  try {
    reportResult = await require('./report.js')({ headers: {} }, null);
  } catch (e) { /* non-fatal */ }

  // 4. Combined digest email
  let emailStatus = 'Email not configured';
  if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD && results.length) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
      });
      let digest = `🤖 DEV CRAFT AGENT - AUTOMATIONS RUN (${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })})\n\n`;
      for (const r of results) {
        digest += `━━━ ${r.name} ${r.success ? '✅' : '❌'} ━━━\n`;
        digest += `Prompt: ${r.prompt}\n\n${r.reply}\n`;
        if (r.steps && r.steps.length) digest += `Steps:\n- ${r.steps.join('\n- ')}\n`;
        digest += '\n';
      }
      await transporter.sendMail({
        from: '"Dev Craft Agent" <' + process.env.EMAIL_USER + '>',
        to: process.env.REPORT_EMAIL || process.env.EMAIL_USER,
        subject: '🤖 Automations Run - ' + new Date().toLocaleDateString('en-PK'),
        text: digest
      });
      emailStatus = 'Digest email sent ✅';
    } catch (e) { emailStatus = 'Email failed: ' + e.message; }
  }

  const payload = {
    success: true,
    ran_at: new Date().toISOString(),
    automations_total: automations.length,
    automations_run: results.length,
    results,
    report: reportResult,
    email_status: emailStatus,
    note: !automations.length ? 'Koi active automation nahi mili. Chat mein "roz [kaam] karo" bol ke automation banao, ya POST /api/automations {action:create, name, prompt} use karo. Supabase "automations" table chahiye.' : undefined
  };

  if (res) res.json(payload);
  return payload;
};
