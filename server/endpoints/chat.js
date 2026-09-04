// ============================================
// MAIN AGENT BRAIN v2 - /api/chat  (AGENTIC!)
// Ab agent sirf baat nahi karta — KHUD kaam karta hai:
//   - user link de => khud audit/clone karta hai
//   - "leads dhoondo" => khud search karta hai
//   - "website bana ke deploy karo" => khud zip/deploy karta hai
//   - har kaam ka STEP chat mein dikhta hai (jaise Solene karta hai)
// POST { "message": "...", "history": [...] } => { reply, steps, links }
// ============================================
const OpenAI = require('openai');

const SYSTEM_PROMPT = `You are "Dev Craft Agent" - the AI assistant of Dev Craft Studio, a web design & web app agency run by Wishal (a student developer from Pakistan).

## HOW YOU BEHAVE (VERY IMPORTANT - like a proactive human assistant):
- You DON'T just talk - you DO things with your tools. If the user gives a URL, immediately audit it with audit_website. If they ask to find leads, call search_businesses. Never say "you can use the /api/x endpoint" - YOU run it yourself!
- Any link the user pastes in chat = you process it (audit it, summarize it, suggest what to do with it).
- Work step by step. When you finish a tool call, briefly note the key finding before moving on.
- Be warm and human. Light humor is fine. Reply in the SAME language style the user writes (Roman Urdu mix is great).
- Keep replies SHORT and actionable. Use max 5 bullet points. End with a concrete next-step suggestion (not "let me know" - instead suggest: "audit karun?" / "deploy kar doon?").
- Never invent tool results. If a tool errors, say what failed honestly and suggest a fix.

## YOUR TOOLS:
1. audit_website(url) - live website audit: HTTPS, mobile-friendly, speed, design, SEO. Use it automatically whenever a URL appears.
2. search_businesses(query, location) - Google search for real businesses.
3. score_lead(business_name, website, city, ...) - lead scoring for prospects.
4. clone_site(url) - clone a website's design into a zip.
5. build_and_deploy(project_name, index_html) - write a complete static website (single index.html with inline CSS/JS) and deploy it LIVE to Vercel. Returns the live URL. Use when user asks to build/deploy a site or wants a free homepage concept.
6. read_emails(max, classify) - read inbox replies and classify them.

## AGENCY RULES:
- Lead strategy: established business + weak website = hot lead (dental, restaurants, construction, law firms, salons).
- Outreach: honest emails, "free homepage concept" offer. Never spam.
- Pricing: Starter 5-page, Business (booking/forms/SEO), Premium (custom/web apps). US/UK/Canada higher, Pakistan lower.
- Discounts: 2% pehle, max 5% - us se zyada Wishal se poochna.
- Every site must include privacy policy, terms, license (client can't resell).
- CLIENT HANDLING: naya client mile to pehle Wishal ko batana. Source code kabhi client ko mat dena bina Wishal ki permission ke. Payment kabhi accept mat karna bina Wishal ke approval ke (Payoneer international, JazzCash Pakistan).

## ETHICS (NEVER BREAK):
- Never guarantee sales, clients, revenue, or profit
- Never write deceptive, misleading, or spam content
- Be honest about what a website can achieve`;

// ---------- tool schemas ----------
const TOOLS = [
  { type: 'function', function: { name: 'audit_website', description: 'Kisi bhi website ka live audit - HTTPS, mobile, speed, design, SEO. URL mile to ye khud chalao.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'search_businesses', description: 'Real businesses dhoondo (Google search). query = business type, location = city/country', parameters: { type: 'object', properties: { query: { type: 'string' }, location: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'score_lead', description: 'Ek business lead ko score karo (established business + weak website = high score)', parameters: { type: 'object', properties: { business_name: { type: 'string' }, website: { type: 'string' }, city: { type: 'string' }, country: { type: 'string' }, category: { type: 'string' } }, required: ['business_name'] } } },
  { type: 'function', function: { name: 'clone_site', description: 'Website ka design/HTML clone karke zip banata hai (sirf reference ke liye)', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'build_and_deploy', description: 'Ek complete static website likho (single index.html, inline CSS/JS, responsive, professional) aur Vercel pe LIVE deploy karo. Live URL milta hai.', parameters: { type: 'object', properties: { project_name: { type: 'string', description: 'lowercase-dashes, e.g. client-restaurant-site' }, index_html: { type: 'string', description: 'COMPLETE index.html content' } }, required: ['project_name', 'index_html'] } } },
  { type: 'function', function: { name: 'read_emails', description: 'Inbox ke latest replies padho aur classify karo', parameters: { type: 'object', properties: { max: { type: 'number' }, classify: { type: 'boolean' } } } } },
];

// ---------- internal executor (apne hi endpoints ko mock req/res se chalao) ----------
const endpoints = {
  audit: require('./audit.js'),
  search: require('./search.js'),
  score: require('./score.js'),
  'clone-site': require('./clone-site.js'),
  'deploy-vercel': require('./deploy-vercel.js'),
  'read-emails': require('./read-emails.js'),
};

async function callEndpoint(name, body) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const mockRes = {
      setHeader: () => {},
      status: (c) => { mockRes._c = c; return mockRes; },
      json: (d) => finish({ status: mockRes._c || 200, data: d }),
      end: () => finish({ status: mockRes._c || 200, data: null }),
      _c: 200,
    };
    const mockReq = { method: 'POST', body, headers: {} };
    try {
      Promise.resolve(endpoints[name](mockReq, mockRes)).catch(e => finish({ status: 500, data: { error: e.message } }));
    } catch (e) { finish({ status: 500, data: { error: e.message } }); }
    setTimeout(() => finish({ status: 504, data: { error: 'timeout (60s)' } }), 60000);
  });
}

function trunc(s, n = 3500) { s = typeof s === 'string' ? s : JSON.stringify(s); return s.length > n ? s.slice(0, n) + '...[truncated]' : s; }

const STEP_ICON = { audit_website: '🔍', search_businesses: '🔎', score_lead: '📊', clone_site: '📦', build_and_deploy: '🚀', read_emails: '📧' };
const STEP_TITLE = { audit_website: 'Website audit kar raha hoon', search_businesses: 'Businesses dhoond raha hoon', score_lead: 'Lead score kar raha hoon', clone_site: 'Website clone kar raha hoon', build_and_deploy: 'Website bana ke deploy kar raha hoon', read_emails: 'Emails padh raha hoon' };

// endpoint deploy-vercel expects { secret } — server-side inject
async function runTool(name, args, steps) {
  const step = { title: `${STEP_ICON[name] || '⚙️'} ${STEP_TITLE[name] || name}`, status: 'working', detail: '' };
  steps.push(step);
  let body = { ...args };
  let epName = name;
  if (name === 'score_lead') { epName = 'score'; body = { business_name: args.business_name, website: args.website, city: args.city, country: args.country, business_category: args.category }; }
  if (name === 'clone_site') { epName = 'clone-site'; body = { url: args.url }; }
  if (name === 'build_and_deploy') { epName = 'deploy-vercel'; body = { secret: process.env.DEPLOY_SECRET || '', project_name: args.project_name, files: [{ name: 'index.html', content: args.index_html }] }; }
  if (name === 'search_businesses') { epName = 'search'; body = { query: args.query, location: args.location }; }
  const r = await callEndpoint(epName, body);
  const ok = r.status < 400 && !(r.data && r.data.error);
  step.status = ok ? 'done' : 'error';
  if (name === 'build_and_deploy' && r.data && r.data.live_url) step.detail = r.data.live_url;
  else if (name === 'audit_website' && r.data) step.detail = (r.data.https ? 'HTTPS ok' : 'HTTPS missing') + (r.data.mobile_friendly === false ? ' | mobile issue' : '');
  else step.detail = ok ? 'complete' : (r.data && r.data.error ? String(r.data.error).slice(0, 120) : 'fail');
  return JSON.stringify(r.data && r.data.zip_base64 ? { ...r.data, zip_base64: `[zip ready, ${(r.data.size_bytes/1024).toFixed(0)}KB - base64 response mein hai]` } : r.data);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY env var missing (Vercel > Settings > Environment Variables - ENCRYPTED type, not Sensitive!)' });
  }

  try {
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message is required' });

    const steps = [];
    const links = [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(Array.isArray(history) ? history.slice(-10) : []),
      { role: 'user', content: message },
    ];

    let reply = '';
    for (let round = 0; round < 4; round++) {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages, tools: TOOLS, max_tokens: 1500,
      });
      const msg = completion.choices[0].message;
      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const result = await runTool(tc.function.name, args, steps);
          if (tc.function.name === 'build_and_deploy') { try { const d = JSON.parse(result); if (d.live_url) links.push(d.live_url); } catch {} }
          messages.push({ role: 'tool', tool_call_id: tc.id, content: trunc(result) });
        }
        continue; // agli round - model result dekhe aur aage badhe
      }
      reply = msg.content || '';
      break;
    }
    if (!reply) reply = 'Kaam ho gaya! 👆 Upar steps dekho - koi sawal ho to poocho.';

    // reply ke andar ke URLs bhi links mein daal do
    for (const m of (reply.match(/https?:\/\/[^\s)]+/g) || [])) if (!links.includes(m)) links.push(m);

    res.json({ reply, steps, links });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
