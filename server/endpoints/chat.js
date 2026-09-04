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

## INTENT MODES (user ke kaam ka TYPE pehle pehchano, phir usi style mein karo):
1. WEBSITE REQUEST ("website banao", "site bana do", "homepage banao", "landing page chahiye"):
   - SABSE PEHLE user ki baat dhyan se suno. User ne HOSTING ka zikr nahi kiya => DEPLOY MAT KARO. Complete professional website ka code likho (single index.html, inline CSS/JS, responsive, hero + about + services + pricing + contact + footer sections) aur poora code reply mein do, phir poocho: "Main ise Vercel pe live bhi kar sakta hoon - deploy karun?"
   - User ne clearly bola "host karo", "deploy karo", "live karo" => tabhi build_and_deploy call karo aur live URL do.
   - Business ka naam/type/section details missing hon to 1-2 chhote sawal poocho (naam, kaam ka type, colours/brand) - lekin sawal kam rakho, user bore na ho. Agar user jaldi mein ho to sensible assumptions ke saath bana ke code de do aur "details do, customize kar dunga" bolo.
   - GOLDEN RULE: Koi bhi BADA action (deploy, email send, payment link) hamesha pehle confirm karo - chhote kaam (audit, search, code likhna) bina poochhe kar sakte ho.
2. STEP-WISE REQUEST ("step by step batavo", "steps mein karo", "sirf step wise kaam karo", "aaram se ek ek step"):
   - Pehle ek numbered plan do (Step 1, Step 2, ...) aur har step complete hone par chhota result note karo. Ek waqt mein ek hi step - user se "agli step?" nahi poochna, khud chalte raho lekin har step clearly dikhe.
3. AUTOMATION / SCHEDULE REQUEST ("roz karo", "har roz", "daily", "every morning", "schedule karo", "automation banao", "har hafte", "weekly"):
   - User jo kaam bolta hai uska ek clear PROMPT banao aur create_automation tool se save karo. Confirm karo: "Ye automation save ho gayi - roz 9 AM PKT khud chalegi ✅". Schedule sirf daily/weekly/monthly support hai - ye honestly batana.
   - "Mere automations dikhao" => list_automations. "Ye automation hatao" => delete_automation.

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
  { type: 'function', function: { name: 'build_and_deploy', description: 'Ek complete static website deploy karke Vercel pe LIVE karo. Live URL milta hai. SIRF tab use karo jab user ne EXPLICITLY hosting/deploy/live karne ko kaha ho - warna sirf code likh ke do aur poocho.', parameters: { type: 'object', properties: { project_name: { type: 'string', description: 'lowercase-dashes, e.g. client-restaurant-site' }, index_html: { type: 'string', description: 'COMPLETE index.html content' } }, required: ['project_name', 'index_html'] } } },
  { type: 'function', function: { name: 'read_emails', description: 'Inbox ke latest replies padho aur classify karo', parameters: { type: 'object', properties: { max: { type: 'number' }, classify: { type: 'boolean' } } } } },
  { type: 'function', function: { name: 'create_automation', description: 'Ek scheduled automation save karo - jo roz 9 AM PKT khud chalegi. prompt = poora kaam jo karna hai (agent khud execute karega, tools ke saath).', parameters: { type: 'object', properties: { name: { type: 'string', description: 'chhota naam, e.g. roz-leads-dhundo' }, prompt: { type: 'string', description: 'poora kaam jo har roz karna hai' }, schedule: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'abhi sirf daily support hai' } }, required: ['name', 'prompt'] } } },
  { type: 'function', function: { name: 'list_automations', description: 'Saari saved automations dikhao (name, prompt, schedule, last_run)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'delete_automation', description: 'Ek saved automation delete karo', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'run_pc_command', description: 'User ke connected PC/laptop pe terminal command chalao (Windows/Linux). SIRF tab use karo jab user ka PC connected ho - warna batao "pehle Connect PC page se PC connect karo". Commands: file dekhna, projects banana, git, npm, system info waghera.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'shell command, e.g. "dir" (Windows) ya "ls -la" (Linux)' } }, required: ['command'] } } },
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

const STEP_ICON = { audit_website: '🔍', search_businesses: '🔎', score_lead: '📊', clone_site: '📦', build_and_deploy: '🚀', read_emails: '📧', create_automation: '💾', list_automations: '📋', delete_automation: '🗑', run_pc_command: '💻' };
const STEP_TITLE = { audit_website: 'Website audit kar raha hoon', search_businesses: 'Businesses dhoond raha hoon', score_lead: 'Lead score kar raha hoon', clone_site: 'Website clone kar raha hoon', build_and_deploy: 'Website bana ke deploy kar raha hoon', read_emails: 'Emails padh raha hoon', create_automation: 'Automation save kar raha hoon', list_automations: 'Automations list kar raha hoon', delete_automation: 'Automation delete kar raha hoon', run_pc_command: 'PC pe command chala raha hoon' };

// ---------- bridge (PC) helpers ----------
async function bridgeApi(action, body) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const mockRes = {
      setHeader: () => {},
      status: (c) => { mockRes._c = c; return mockRes; },
      json: (d) => finish({ status: mockRes._c || 200, data: d }),
      _c: 200,
    };
    const mockReq = { method: 'POST', body: { action, ...body }, headers: {} };
    try {
      Promise.resolve(endpoints.bridge(mockReq, mockRes)).catch(e => finish({ status: 500, data: { error: e.message } }));
    } catch (e) { finish({ status: 500, data: { error: e.message } }); }
    setTimeout(() => finish({ status: 504, data: { error: 'timeout' } }), 45000);
  });
}

async function getOnlineDevice() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    const r = await bridgeApi('devices', {});
    const list = (r.data && r.data.devices) || [];
    const online = list.filter(d => d.online);
    // sab se recent online device
    online.sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    return online[0] || null;
  }
  return null;
}

async function createBridgeJob(deviceId, type, payload) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_ANON_KEY;
  const headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
  const r = await fetch(SB_URL + '/rest/v1/bridge_jobs', { method: 'POST', headers, body: JSON.stringify({ device_id: deviceId, type, payload, status: 'pending' }) });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] ? rows[0].id : null;
}

async function waitBridgeJob(jobId, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 1500));
    const r = await bridgeApi('job_status', { job_id: jobId });
    const job = r.data && r.data.job;
    if (job && (job.status === 'done' || job.status === 'error')) {
      return job.result || { error: 'no result' };
    }
  }
  return null;
}

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
  if (name === 'create_automation') { epName = 'automations'; body = { action: 'create', name: args.name, prompt: args.prompt, schedule: args.schedule || 'daily' }; }
  if (name === 'run_pc_command') {
    // connected device dhundo, job banao, bridge ka result wait karo
    const device = await getOnlineDevice();
    if (!device) return JSON.stringify({ error: 'Koi PC connected nahi hai. User ko bolo: menu > Connect PC se apna PC/laptop connect karo (node bridge.js <code>).' });
    const jobId = await createBridgeJob(device.id, 'shell', { command: args.command, cwd: args.cwd });
    const result = await waitBridgeJob(jobId, 35000);
    if (result === null) return JSON.stringify({ error: 'PC se jawab nahi aaya (timeout) - bridge chal raha hai? command: ' + args.command });
    return JSON.stringify(result);
  }
  if (name === 'list_automations') { epName = 'automations'; body = { action: 'list' }; }
  if (name === 'delete_automation') { epName = 'automations'; body = { action: 'delete', id: args.id }; }
  const r = await callEndpoint(epName, body);
  const ok = r.status < 400 && !(r.data && r.data.error);
  step.status = ok ? 'done' : 'error';
  if (name === 'build_and_deploy' && r.data && r.data.live_url) step.detail = r.data.live_url;
  else if (name === 'audit_website' && r.data) step.detail = (r.data.https ? 'HTTPS ok' : 'HTTPS missing') + (r.data.mobile_friendly === false ? ' | mobile issue' : '');
  else step.detail = ok ? 'complete' : (r.data && r.data.error ? String(r.data.error).slice(0, 120) : 'fail');
  return JSON.stringify(r.data && r.data.zip_base64 ? { ...r.data, zip_base64: `[zip ready, ${(r.data.size_bytes/1024).toFixed(0)}KB - base64 response mein hai]` } : r.data);
}

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const { message, history, api_key, provider, model, device_id } = req.body || {};

  // ---- OLLAMA (local PC) mode: bridge ke through local model ----
  if (provider === 'ollama') {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Ollama mode ke liye Supabase env vars chahiye (bridge system).' });
    }
    const rDevices = await bridgeApi('devices', {});
    const devices = ((rDevices.data && rDevices.data.devices) || []).filter(d => d.online);
    if (!devices.length) return res.status(400).json({ error: 'Koi PC connected nahi. Menu > Connect PC se apna PC connect karo (Ollama us PC pe hona chahiye).' });
    const device = device_id ? (devices.find(d => d.id === device_id) || devices[0]) : devices[0];
    const chosenModel = model || (device.ollama_models && device.ollama_models[0]);
    if (!chosenModel) return res.status(400).json({ error: 'Is PC pe koi Ollama model nahi mila. "ollama pull llama3.2" chalao.' });
    const jobId = await createBridgeJob(device.id, 'ollama_chat', { model: chosenModel, messages: [
      { role: 'system', content: 'You are Dev Craft Agent. Reply in the same language the user uses (Urdu/Roman Urdu mix is fine). Be helpful, concise.' },
      ...(Array.isArray(history) ? history.slice(-8).map(h => ({ role: h.role, content: h.content })) : []),
      { role: 'user', content: message }
    ] });
    if (!jobId) return res.status(500).json({ error: 'Job create nahi hua (bridge_jobs table hai?)' });
    const result = await waitBridgeJob(jobId, 45000);
    if (result === null) return res.status(504).json({ error: 'PC se jawab nahi aaya - bridge/Ollama chal raha hai?' });
    if (result.error) return res.status(500).json({ error: 'Ollama error: ' + result.error });
    return res.json({ reply: result.reply || '(khali jawab)', steps: [{ title: '🦙 Local Ollama se jawab (' + chosenModel + ')', status: 'done', detail: device.device_name }], links: [] });
  }

  // ---- provider resolve: openai | openrouter | custom ----
  let baseURL;
  if (provider === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
  else if (provider === 'custom') {
    if (!req.body.base_url) return res.status(400).json({ error: 'Custom API ke liye base URL chahiye (Settings mein daalo)' });
    baseURL = req.body.base_url.replace(/\/+$/, '');
  }
  const userKey = api_key || process.env.OPENAI_API_KEY;
  if (!userKey) {
    return res.status(500).json({ error: 'API key missing - Settings (menu > Settings) mein apni personal API key paste karo (OpenAI / OpenRouter / Custom), ya Vercel pe OPENAI_API_KEY set karo.' });
  }
  const openai = new OpenAI({ apiKey: userKey, ...(baseURL ? { baseURL } : {}) });

  try {
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
        model: model || process.env.OPENAI_MODEL || (provider === 'openrouter' ? 'openrouter/auto' : 'gpt-4o-mini'),
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

// Exports - run-automations.js (cron) inhe reuse karta hai
handler.SYSTEM_PROMPT = SYSTEM_PROMPT;
handler.TOOLS = TOOLS;
handler.runTool = runTool;
module.exports = handler;
