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
const vault = require('../lib/credentials.js');
const google = require('./google.js');

// ---- AI BRAIN providers (OpenAI-compatible) — connect_ai_brain + handler dono use karte hain ----
const BRAIN_PROVIDERS = {
  gemini:    { url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash', label: 'Google Gemini' },
  openai:    { url: null, model: 'gpt-4o-mini', label: 'OpenAI' },
  openrouter:{ url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', label: 'OpenRouter' },
  groq:      { url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', label: 'Groq' },
  deepseek:  { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', label: 'DeepSeek' },
  mistral:   { url: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', label: 'Mistral' },
  anthropic: { url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-20250514', label: 'Anthropic (Claude)' },
  custom:    { url: null, model: null, label: 'Custom API' },
};
const auth = require('../lib/auth.js');

const SYSTEM_PROMPT = `You are "Dev Craft Agent" - the AI assistant of Dev Craft Studio, a web design & web app agency run by Wishal Noor (a student developer from Pakistan). CREATOR: agar koi poochhe 'tumhe kis ne banaya / who created you / developer kaun hai' to hamesha khud se bolo: 'Mujhe Wishal Noor ne banaya hai' (owner/creator = Wishal Noor, Dev Craft Studio).

## HOW YOU BEHAVE (VERY IMPORTANT - like a proactive human assistant):
- You DON'T just talk - you DO things with your tools. If the user gives a URL, immediately audit it with audit_website. If they ask to find leads, call search_businesses. Never say "you can use the /api/x endpoint" - YOU run it yourself!
- Any link the user pastes in chat = you process it (audit it, summarize it, suggest what to do with it).
- Work step by step. When you finish a tool call, briefly note the key finding before moving on.
- Be warm and human. Light humor is fine. Reply in the SAME language style the user writes (Roman Urdu mix is great).
- Keep replies SHORT and actionable. Use max 5 bullet points. End with a concrete next-step suggestion (not "let me know" - instead suggest: "audit karun?" / "deploy kar doon?").
- Never invent tool results. If a tool errors, say what failed honestly and suggest a fix.
- CASUAL/GREETING MESSAGES ("kaisi ho", "kai hal ha", "hi", "thanks", "shukriya", chhoti baatein): SIRF casually reply karo jaise dost karta hai. Har baar "Aaj kya plan hai / kaise madad karoon / 1. Website 2. Leads 3. Audit" wala options-menu MAT thoko. User ko jab kaam hoga wo khud bata dega - baar baar mat poocho ke kya karun. Sirf pehli hi message (naya conversation) pe ya jab user khud pooche "kya kar sakte ho" tab hi options do.

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

## CREDENTIALS SKILL (Solene-style - token par kaam karna):
- User jo bhi API token/key/credentials chat mein de (ya "token save karo" bole), TURANT save_credential se save karo. Name UPPERCASE standard: GITHUB_TOKEN, GITLAB_TOKEN, NOTION_TOKEN, TELEGRAM_BOT_TOKEN, STRIPE_SECRET_KEY, TWITTER_BEARER_TOKEN, GITHUB/GITLAB/STRIPE waghera.
- "mere tokens dikhao" => list_credentials. "ye token hatao" => delete_credential (pehle confirm karo).
- AI API KEY + AI BRAIN: user chat mein koi AI ki API key de (e.g. "ye Gemini ki key hai") aur bole "connect as AI brain" / "is se socho" / "ye use karo" → turant connect_ai_brain chalao (provider = user ka bola hua AI naam: Gemini→gemini, ChatGPT/OpenAI→openai, Claude→anthropic, Groq→groq, DeepSeek→deepseek, Mistral→mistral, OpenRouter→openrouter). Success pe confirm karo: "✅ <AI naam> ab mera brain hai — agli message se isi se sochunga". Agar user key de lekin KYA KARNA hai na bole to ek baar poochho: "kya karun — AI brain banaun ya sirf vault mein save karun?"
- "brain disconnect / wapas settings wala" bole to delete_credential se BRAIN_API_KEY delete karo.
- GOOGLE CONNECTED: user ka Google account connect ho (Settings > Google Account) to Gmail/Calendar/Drive ke saare kaam google_request se karo — token khud manage hota hai. "mere emails padho", "calendar mein meeting daalo", "Drive mein kya hai" — sab is se. Connected nahi to Settings > Google Account > Connect bolo.
- KOI BHI PLATFORM ka kaam: user ka token vault mein ho to api_request use karo — { url, method, token_name, body }. Ye automatically Bearer auth lagata hai. GitHub repos, GitLab, Notion pages, Slack messages, Stripe payments, Twitter posts — koi bhi REST API. 401 aaye to user ko sahi token save karne bolo.
- Save hone par user ko bolo: "encrypted ho kar save ho gaya ✅ (main sirf masked dikha sakta hoon)". Token kabhi wapas plain text mein mat likhna - sirf pehle 4 aur aakhri 4 characters.
- Jab bhi kisi tool mein token chahiye (GitHub repo banana, Notion entry, Stripe link, Telegram), PEHLE check karo - saved credential hota to khud use karo aur user ko bolna nahi padta. Vault empty ho to user se token maango.
- PER-USER: har user ka vault ALAG hai (user_id ke hisaab se). Ek user ka token doosre user ko kabhi nahi dikhta/milta. list_credentials sirf usi user ke tokens dikhata hai jo chat kar raha hai.
- SECURITY: tokens chat log mein store nahi hote tumhare, sirf vault mein encrypted. User ka token kisi third party ko kabhi mat dena.

## MCP SKILL (Model Context Protocol - jaise pro AI agents):
- User "MCP connect karo" / "MCP server jodo" bole to: pehle mcp_list_servers chalao. Agar server saved nahi, to user se MCP server URL maango (aur optional auth token), phir "Connect MCP" panel se add karne ko bolo - ya batao ke sidebar > Connect MCP mein URL + token daale.
- Server saved ho to mcp_test_server chalao - isse pata chalta hai server ke paas KAUN SE tools hain.
- User ka kaam MCP server ke tool se ho sakta hai (Supabase queries, database edits, docs, koi bhi MCP service) to mcp_call_tool use karo: { server: naam, tool: tool ka naam, args: {} }. Tool ke params pehle test/confirm karke samjho.
- MCP server fail ho to honest bolo: "MCP server connect nahi hua - URL/token check karo".
- MCP ke bina bhi sab normal tools chalte hain - MCP sirf EXTRA power hai.
- WHATSAPP (Cloud API mode - per-user): user bole 'mera WhatsApp Cloud API connect karo' + Meta token/phone_id de → whatsapp_connect. 'Tom ko WhatsApp pe message bhejo' → agar number nahi to poochho, phir whatsapp_send {to, text}. Connected hai ya nahi → whatsapp_status. Ye user ka APNA WhatsApp Business number hai (Meta Cloud API). Desktop app ka WhatsApp Web mode alag hai (laptop wala). MESSAGE DELETE: Cloud API se bheja message DELETE karna possible NAHI hai (Meta delete API deta hi nahi) — user delete maange to batao: ye sirf DESKTOP app (WhatsApp Web mode) se ho sakta hai, aur delete-for-everyone sirf recent messages pe.

## AUTH SKILL (user ki website mein login laga do - REAL recipe, maine khud DCA pe use ki hai):
- TRIGGER: "auth laga do", "login system banao", "Google login daalo", "sign in laga do", "user accounts chahiye", "members only area", "password protection".
- Best FREE tareeka (static site pe bhi chalta hai): Supabase Auth + Google login. User ko ye steps batao (ya khud karwao):
  1. supabase.com pe free account → New Project (region: Singapore - Pakistan/India ke liye fast). Settings > API se Project URL + anon key milegi.
  2. Google login chahiye to: Google Cloud Console → New Project → OAuth consent screen (External) → Credentials → OAuth Client ID (Web app) → Authorized Redirect URI EXACT: https://PROJECT_REF.supabase.co/auth/v1/callback → Client ID + Secret copy karo.
  3. Supabase Dashboard → Authentication → Providers → Google → ON + ID/Secret paste. → Authentication → URL Configuration → Site URL = user ka live site URL.
- CODE (tum khud likho, build_and_deploy mein bhi daalo): supabase-js ko SELF-HOST karo (public/supabase.js) - CDN jsdelivr Pakistan mein unreliable hai, login chupchaap fail hota hai. Phir:
  - window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  - Login card (DC Agent jaisa): brand logo + "Sign in to continue" + Google G icon wala "Continue with Google" button → sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })
  - sb.auth.onAuthStateChange se session track karo; logged-in pe user ka naam/email dikhao, protected content unlock, Log out button do (sb.auth.signOut()).
  - pehle sb.auth.getSession() se check karo - already logged-in user ko seedha andar le jao.
- HAR USER KA DATA ALAG (imp): Supabase table banao, RLS ON + policy "auth.uid() = user_id". Insert/select mein user_id = (await sb.auth.getUser()).data.user.id. RLS ke bina sabka data sabko dikhega - ye kabhi mat chhodo.
- GOTCHAS (maine khud fasey hoon): ANON KEY frontend mein daalna SAFE hai (RLS hi asli security hai), service_role key KABHI frontend mein nahi. Google Console ka redirect URI EXACT match hona chahiye (https, koi typo nahi). /auth/v1/settings check karna ho to apikey header bhejo, warna 401. Google login sirf EMAIL scope maango (email+profile) - sensitive scopes verifyation mangte hain.
- User Google Console ka jhanjhat nahi chahta to SIMPLER option offer karo: Supabase ka EMAIL-PASSWORD login (default ON hai, sirf Supabase project chahiye, Google nahi). Ya sirf demo password-gate (honestly bolo: ye real security NAHI hai).

## AGENCY RULES:
- Lead strategy: established business + weak website = hot lead (dental, restaurants, construction, law firms, salons).
- Outreach: honest emails, "free homepage concept" offer. Never spam.
- Pricing: Starter 5-page, Business (booking/forms/SEO), Premium (custom/web apps). US/UK/Canada higher, Pakistan lower.
- Discounts: 2% pehle, max 5% - us se zyada Wishal se poochna.
- Every site must include privacy policy, terms, license (client can't resell).
- CLIENT HANDLING: naya client mile to pehle Wishal ko batana. Source code kabhi client ko mat dena bina Wishal ki permission ke. Payment kabhi accept mat karna bina Wishal ke approval ke (Payoneer international, JazzCash Pakistan).

## DEVICE RULES (run_pc_command + run_device_tool - user ke APNE connected device, per-user private):
- run_pc_command: shell command user ke connected device pe (laptop/desktop app YA Android phone via Termux). Termux pe Android apps/CLI: pkg install. Windows pe: winget. Har user ko SIRF apna device dikhta hai (privacy).
- run_device_tool: SIRF laptop/desktop-app devices ke liye (whatsapp_send {to,text}, youtube {query,number}, chrome, file_*). User bole "laptop se WhatsApp bhejo" to isse.
- Koi device connected na ho to user ko setup steps batao (laptop: Desktop app / Connect PC; Android: Terminal page > "Pairing code lo" > Termux: pkg install nodejs, curl se mobile-agent.js, node mobile-agent.js <code>).
- Bade/dangerous commands (rm -rf, format, big installs) se PEHLE user se confirm karo.

## PACKAGING SKILLS (jab user ka device connected ho - run_pc_command se):
- "folder ko EXE banao" => PC pe: Node script ho to "npx --yes pkg app.js --output app.exe"; Python ho to "pip install pyinstaller && pyinstaller --onefile main.py"; koi bhi folder ho to 7-Zip self-extracting EXE: "7z a -sfx output.exe foldername" (7z missing to pehle winget install 7zip.7zip chalao).
- "APK banao / APK me convert karo" => Android project folder ho to: "cd project && gradle wrapper && gradlew assembleDebug" (APK: app/build/outputs/apk/debug/app-debug.apk). Website/HTML folder ho to pehle WebView wrapper project banao (assets mein HTML copy + WebView MainActivity) phir gradle build. JDK 17 + Android SDK + Gradle chahiye - pehle check karo (java -version, gradle --version), missing ho to install karo ya steps batao.
- "zip banao" => Windows: powershell Compress-Archive, Linux/Mac: zip -r output.zip folder
- In sab mein bade installs (SDK, JDK) se PEHLE user se confirm karo.

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
  { type: 'function', function: { name: 'save_credential', description: 'User ka API token/key/password encrypted vault mein save karo. User jab bhi koi token de ya "save karo" bole to ye use karo.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'standard env-style naam, e.g. GITHUB_TOKEN' }, value: { type: 'string', description: 'asli token value' }, description: { type: 'string', description: 'chhoti note (optional)' } }, required: ['name', 'value'] } } },
  { type: 'function', function: { name: 'list_credentials', description: 'Saare saved tokens ki masked list dikhao (values nahi dikhti)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'delete_credential', description: 'Saved token ko vault se hatao. Pehle user se confirm karo.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'api_request', description: 'Kisi BHI platform ka REST API call karo - user ke saved vault token ke saath (ya bina token). Jab koi dedicated tool na ho (GitHub, GitLab, Notion, Slack, Twitter, Telegram, Stripe, DigitalOcean, Cloudflare, koi bhi platform) to ye use karo. token_name = vault mein saved naam (e.g. GITHUB_TOKEN), wo automatically Authorization: Bearer header mein lag jayega. Ek baar 401/403 aaye to user ko bolo ke sahi token save kare.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'poora API URL, e.g. https://api.github.com/user' }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, token_name: { type: 'string', description: 'vault mein saved token ka naam (optional)' }, headers: { type: 'object', description: 'extra headers (optional)' }, body: { type: 'object', description: 'JSON body POST/PUT/PATCH ke liye (optional)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'mcp_list_servers', description: 'User ke saved MCP servers list karo (naam + URL)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_test_server', description: 'MCP server se connect karke uske tools ki list lao (server saved ho naam do, warna url)', parameters: { type: 'object', properties: { server: { type: 'string', description: 'saved server ka naam (optional)' }, url: { type: 'string', description: 'direct MCP URL (agar saved nahi)' } }, required: [] } } },
  { type: 'function', function: { name: 'mcp_call_tool', description: 'User ke MCP server ka koi tool chalao (Supabase/database/docs waghera ka kaam)', parameters: { type: 'object', properties: { server: { type: 'string', description: 'saved MCP server ka naam' }, tool: { type: 'string' }, args: { type: 'object', description: 'tool ke arguments (JSON)' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'create_automation', description: 'Ek scheduled automation save karo - jo roz 9 AM PKT khud chalegi. prompt = poora kaam jo karna hai (agent khud execute karega, tools ke saath).', parameters: { type: 'object', properties: { name: { type: 'string', description: 'chhota naam, e.g. roz-leads-dhundo' }, prompt: { type: 'string', description: 'poora kaam jo har roz karna hai' }, schedule: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'abhi sirf daily support hai' } }, required: ['name', 'prompt'] } } },
  { type: 'function', function: { name: 'list_automations', description: 'Saari saved automations dikhao (name, prompt, schedule, last_run)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'delete_automation', description: 'Ek saved automation delete karo', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'run_pc_command', description: 'User ke CONNECTED DEVICE (laptop/desktop app ya Android phone-Termux) pe terminal command chalao. User bole "PC/laptop/phone pe ye karo", "python install karo", "project banao", "files dikhao" etc to YE use karo. Koi device connected na ho to user ko Setup batao: laptop = Desktop app ya Connect PC; Android = Terminal page > Pairing code > Termux (node mobile-agent.js <code>). Commands OS ke hisab se: Windows (dir), Linux/Android/Termux (ls).', parameters: { type: 'object', properties: { command: { type: 'string', description: 'shell command, e.g. "dir" (Windows), "ls -la" (Linux/Mac/Termux), "pkg install python -y" (Termux)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'run_device_tool', description: 'User ke connected DEVICE ke desktop tools chalao cloud se (sirf laptop/desktop app devices pe - Termux phone pe nahi): whatsapp_send, whatsapp_open_chat, whatsapp_web connect/status, youtube open/search/play, chrome open/tabs/close/search, file_list/file_read/file_write. User bole "laptop se WhatsApp bhejo" ya "laptop pe YouTube kholo" to YE use karo.', parameters: { type: 'object', properties: { tool: { type: 'string', description: 'tool ka naam, e.g. whatsapp_send, youtube, chrome, file_list' }, args: { type: 'object', description: 'tool ke arguments, e.g. {to:"naam", text:"message"} ya {query:"search", number:2}' } }, required: ['tool'] } } },
  { type: 'function', function: { name: 'google_request', description: "User ke CONNECTED Google account ka API call — Gmail, Calendar, Drive (token khud manage hota hai). User ne Google account connect kiya ho to 'mere emails padho', 'calendar mein event daalo', 'Drive files dikhao' SAB is tool se karo. url examples: Gmail 'https://gmail.googleapis.com/gmail/v1/users/me/messages', Calendar 'https://www.googleapis.com/calendar/v3/users/me/events', Drive 'https://www.googleapis.com/drive/v3/files'", parameters: { type: 'object', properties: { url: { type: 'string', description: 'poora Google API URL (users/me use karo)' }, method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, body: { type: 'object', description: 'JSON body (POST/PUT/PATCH)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'whatsapp_connect', description: "User ka APNA WhatsApp Cloud API (Meta) connect karo — per-user. User Meta Business se Permanent Access Token + Phone Number ID dega. Dono encrypted vault mein save hote hain. Baad mein whatsapp_send se user ke number se messages jayenge.", parameters: { type: 'object', properties: { token: { type: 'string', description: 'Meta permanent access token (EAAG...)' }, phone_id: { type: 'string', description: 'Phone Number ID (digits)' } }, required: ['token', 'phone_id'] } } },
  { type: 'function', function: { name: 'whatsapp_status', description: 'Check karo: user ka WhatsApp Cloud API connected hai ya nahi (masked info)', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'whatsapp_send', description: "User ke apne WhatsApp number se kisi ko DIRECT message bhejo (WhatsApp Cloud API se — laptop on hona zaroori NAHI). to = phone number country code ke saath bina + (e.g. 923001234567), text = message. Note: WhatsApp PEHLI baar message karne pe 24h window rule hota hai — business-initiated message ke liye template chahiye sakta hai; reply-window mein free text jata hai.", parameters: { type: 'object', properties: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'] } } },
  { type: 'function', function: { name: 'connect_ai_brain', description: "User ki di hui AI API key ko AGENT KA BRAIN bana do. Jab user chat mein koi AI ki key de + bole 'connect as AI brain' / 'isse socho' / 'ye use karo' to ye tool chalao. provider = user ne jo AI ka naam bola: gemini (Google Gemini), openai (OpenAI/ChatGPT), openrouter, groq, deepseek, mistral, anthropic (Claude), custom (base_url chahiye). Save hone ke baad agli message se agent usi AI se sochega — phir user ko confirm bolo.", parameters: { type: 'object', properties: { provider: { type: 'string', enum: ['gemini', 'openai', 'openrouter', 'groq', 'deepseek', 'mistral', 'anthropic', 'custom'] }, api_key: { type: 'string', description: 'user ki di hui API key' }, model: { type: 'string', description: 'specific model (optional, default provider ka best)' }, base_url: { type: 'string', description: 'custom provider ke liye base URL' } }, required: ['provider', 'api_key'] } } },
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

const STEP_ICON = { audit_website: '🔍', search_businesses: '🔎', score_lead: '📊', clone_site: '📦', build_and_deploy: '🚀', read_emails: '📧', create_automation: '💾', list_automations: '📋', delete_automation: '🗑', run_pc_command: '💻', run_device_tool: '🔧', save_credential: '🔐', list_credentials: '🗂', delete_credential: '🗑', mcp_list_servers: '🔌', mcp_test_server: '🔌', mcp_call_tool: '🔌', api_request: '🌐', google_request: 'G', connect_ai_brain: '🧠', whatsapp_connect: '💬', whatsapp_status: '💬', whatsapp_send: '💬' };
const STEP_TITLE = { audit_website: 'Website audit kar raha hoon', search_businesses: 'Businesses dhoond raha hoon', score_lead: 'Lead score kar raha hoon', clone_site: 'Website clone kar raha hoon', build_and_deploy: 'Website bana ke deploy kar raha hoon', read_emails: 'Emails padh raha hoon', create_automation: 'Automation save kar raha hoon', list_automations: 'Automations list kar raha hoon', delete_automation: 'Automation delete kar raha hoon', run_pc_command: 'Device pe command chala raha hoon', run_device_tool: 'Device ka tool chala raha hoon', save_credential: 'Token encrypted save kar raha hoon', list_credentials: 'Saved tokens list kar raha hoon', delete_credential: 'Token delete kar raha hoon', mcp_list_servers: 'MCP servers dekh raha hoon', mcp_test_server: 'MCP server se connect kar raha hoon', mcp_call_tool: 'MCP tool chala raha hoon', api_request: 'API call kar raha hoon', google_request: 'Google account se kaam kar raha hoon', connect_ai_brain: 'AI brain connect kar raha hoon', whatsapp_connect: 'WhatsApp Cloud API connect kar raha hoon', whatsapp_status: 'WhatsApp connection check kar raha hoon', whatsapp_send: 'WhatsApp message bhej raha hoon' };

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

// device helpers - PER-USER (sirf verified uid ke devices, service key se)
async function getOnlineDevice(uid) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!SB_URL || !SB_KEY || !uid) return null;
  try {
    const r = await fetch(SB_URL + '/rest/v1/bridge_devices?user_id=eq.' + encodeURIComponent(uid) + '&select=*&order=last_seen.desc', { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
    if (!r.ok) return null;
    const list = await r.json();
    const online = list.filter(d => d.status === 'connected' && d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < 60000);
    return online[0] || null;
  } catch (e) { return null; }
}

async function createBridgeJob(deviceId, type, payload, uid) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
  const r = await fetch(SB_URL + '/rest/v1/bridge_jobs', { method: 'POST', headers, body: JSON.stringify({ device_id: deviceId, user_id: uid, type, payload, status: 'pending' }) });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] ? rows[0].id : null;
}

async function waitBridgeJob(jobId, maxMs, uid) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetch(SB_URL + '/rest/v1/bridge_jobs?id=eq.' + encodeURIComponent(jobId) + '&select=*', { headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY } });
      const rows = await r.json();
      const job = rows[0];
      if (job && uid && job.user_id !== uid) return { error: 'job tumhara nahi' };
      if (job && (job.status === 'done' || job.status === 'error')) return job.result || { error: 'no result' };
    } catch (e) {}
  }
  return null;
}

// mcp endpoint ko in-process call karo (verified uid ke saath)
async function mcpApi(action, body, uid) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const mockRes = { setHeader: () => {}, status: (c) => { mockRes._c = c; return mockRes; }, json: (d) => finish({ ...(mockRes._c && mockRes._c >= 400 ? { error: d.error || 'fail' } : d), _s: mockRes._c }), _c: 200 };
    const mockReq = { method: 'POST', body: { action, ...body, user_id: uid }, headers: {} };
    try {
      Promise.resolve(endpoints.mcp(mockReq, mockRes)).catch(e => finish({ error: e.message }));
    } catch (e) { finish({ error: e.message }); }
    setTimeout(() => finish({ error: 'timeout' }), 45000);
  });
}

// endpoint deploy-vercel expects { secret } — server-side inject
async function runTool(name, args, steps, uid) {
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
    // connected device dhundo (user ka apna - privacy), job banao, result wait karo
    const device = await getOnlineDevice(uid);
    if (!device) return JSON.stringify({ error: 'Koi device connected nahi. User ko bolo: (a) laptop pe Desktop app kholo ya Connect PC se pair karo, (b) Android phone pe: Terminal page > "Pairing code lo" > Termux mein node mobile-agent.js <code>. Phir command dobara bolo.' });
    const jobId = await createBridgeJob(device.id, 'shell', { command: args.command, cwd: args.cwd }, uid);
    if (!jobId) return JSON.stringify({ error: 'Job create fail - device offline hua shayad' });
    const result = await waitBridgeJob(jobId, 35000, uid);
    if (result === null) return JSON.stringify({ error: 'Device se jawab nahi aaya (timeout) - device online hai? command: ' + args.command });
    return JSON.stringify(result);
  }
  if (name === 'run_device_tool') {
    // user ke connected device ke DESKTOP tools (whatsapp_send, youtube, files...) cloud bridge se
    const device = await getOnlineDevice(uid);
    if (!device) return JSON.stringify({ error: 'Koi device connected nahi - pehle Desktop app / mobile agent connect karo' });
    const jobId = await createBridgeJob(device.id, 'tool', { tool: args.tool, args: args.args || {} }, uid);
    if (!jobId) return JSON.stringify({ error: 'Job create fail' });
    const result = await waitBridgeJob(jobId, 60000, uid);
    if (result === null) return JSON.stringify({ error: 'Device se jawab nahi aaya (timeout) - tool: ' + args.tool });
    return JSON.stringify(result);
  }
  if (name === 'save_credential') { epName = null; const r = await vault.saveCredential(args.name, args.value, args.description, uid); step.status = r.error ? 'error' : 'done'; step.detail = r.error ? String(r.error).slice(0, 120) : (r.saved + ' ' + (r.masked || '')); return JSON.stringify(r); }
  if (name === 'list_credentials') { epName = null; const r = await vault.listCredentials(uid); step.status = r.error ? 'error' : 'done'; step.detail = r.error ? String(r.error).slice(0, 120) : ((r.credentials || []).length + ' saved'); return JSON.stringify(r); }
  if (name === 'delete_credential') { epName = null; const r = await vault.deleteCredential(args.name, uid); step.status = r.error ? 'error' : 'done'; step.detail = r.error ? String(r.error).slice(0, 120) : 'deleted'; return JSON.stringify(r); }
  if (name === 'api_request') {
    epName = null;
    const meth = (args.method || 'GET').toUpperCase();
    let token = null;
    if (args.token_name) token = await vault.getCredential(args.token_name, uid);
    const H = { 'Content-Type': 'application/json', ...(args.headers || {}) };
    if (token) H['Authorization'] = 'Bearer ' + token;
    try {
      const opts = { method: meth, headers: H };
      if (meth !== 'GET' && meth !== 'HEAD' && args.body) opts.body = JSON.stringify(args.body);
      const r = await fetch(args.url, opts);
      const txt = await r.text();
      step.status = r.ok ? 'done' : 'error';
      step.detail = 'HTTP ' + r.status;
      return JSON.stringify({ ok: r.ok, status: r.status, data: txt.slice(0, 3500) });
    } catch (e) { step.status = 'error'; step.detail = String(e.message).slice(0, 120); return JSON.stringify({ error: e.message }); }
  }
  if (name === 'google_request') {
    epName = null;
    try {
      const token = await google.getGoogleAccessToken(uid);
      if (!token) { step.status = 'error'; step.detail = 'Google account connected nahi'; return JSON.stringify({ error: 'Google account connected nahi hai. User ko bolo: Settings > Google Account > Connect karo. (Ya GOOGLE_CLIENT_ID/SECRET env missing hai)' }); }
      const meth = (args.method || 'GET').toUpperCase();
      const opts = { method: meth, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
      if (meth !== 'GET' && meth !== 'HEAD' && args.body) opts.body = JSON.stringify(args.body);
      const r = await fetch(args.url, opts);
      const txt = await r.text();
      step.status = r.ok ? 'done' : 'error';
      step.detail = 'HTTP ' + r.status;
      return JSON.stringify({ ok: r.ok, status: r.status, data: txt.slice(0, 4000) });
    } catch (e) { step.status = 'error'; step.detail = String(e.message).slice(0, 120); return JSON.stringify({ error: e.message }); }
  }
  if (name === 'whatsapp_connect') {
    epName = null;
    const wtoken = String(args.token || '').trim();
    const wpid = String(args.phone_id || '').replace(/[^0-9]/g, '');
    if (!wtoken || !wpid) { step.status = 'error'; step.detail = 'token + phone_id chahiye'; return JSON.stringify({ error: 'WhatsApp Cloud API ka token aur phone_id dono chahiye (Meta developers portal se)' }); }
    try {
      const r = await fetch('https://graph.facebook.com/v21.0/' + wpid, { headers: { Authorization: 'Bearer ' + wtoken } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { step.status = 'error'; step.detail = 'token/phone_id galat'; return JSON.stringify({ error: 'Connect fail: ' + ((j.error && j.error.message) || 'HTTP ' + r.status) }); }
      await vault.saveCredential('WA_CLOUD_TOKEN', wtoken, 'WhatsApp Cloud API token (user ka apna)', uid);
      await vault.saveCredential('WA_CLOUD_PHONE_ID', wpid, 'WhatsApp Cloud API Phone Number ID', uid);
      step.status = 'done'; step.detail = 'connected ' + (j.display_phone_number || wpid);
      return JSON.stringify({ ok: true, connected: true, display_phone_number: j.display_phone_number, verified_name: j.verified_name });
    } catch (e) { step.status = 'error'; step.detail = String(e.message || e).slice(0, 120); return JSON.stringify({ error: 'Network error: ' + String(e.message || e) }); }
  }
  if (name === 'whatsapp_status') {
    epName = null;
    const wtoken = await vault.getCredential('WA_CLOUD_TOKEN', uid);
    const wpid = await vault.getCredential('WA_CLOUD_PHONE_ID', uid);
    step.status = 'done'; step.detail = wtoken ? 'connected' : 'not connected';
    return JSON.stringify({ connected: !!(wtoken && wpid), token_masked: wtoken ? wtoken.slice(0, 6) + '...' : null, phone_id: wpid || null, hint: wtoken ? null : 'WhatsApp Cloud API connect karne ke liye Meta Business Access Token + Phone Number ID do aur bolo "connect karo"' });
  }
  if (name === 'whatsapp_send') {
    epName = null;
    const wtoken = await vault.getCredential('WA_CLOUD_TOKEN', uid);
    const wpid = await vault.getCredential('WA_CLOUD_PHONE_ID', uid);
    const wto = String(args.to || '').replace(/[^0-9]/g, '');
    if (!wtoken || !wpid) { step.status = 'error'; step.detail = 'not connected'; return JSON.stringify({ error: 'WhatsApp Cloud API connected nahi hai — pehle apna Meta token + Phone Number ID do (whatsapp_connect)' }); }
    if (!wto) { step.status = 'error'; step.detail = 'to missing'; return JSON.stringify({ error: 'to = phone number country code ke saath chahiye (e.g. 923001234567)' }); }
    try {
      const r = await fetch('https://graph.facebook.com/v21.0/' + wpid + '/messages', { method: 'POST', headers: { Authorization: 'Bearer ' + wtoken, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: wto, type: 'text', text: { body: String(args.text || '') } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { step.status = 'error'; step.detail = 'send fail'; return JSON.stringify({ error: 'Send fail: ' + ((j.error && j.error.message) || 'HTTP ' + r.status), hint: (j.error && j.error.error_subcode === 132000) ? '24h window — pehle registered template use karna padega' : null }); }
      step.status = 'done'; step.detail = 'sent → ' + wto;
      return JSON.stringify({ ok: true, message_id: (j.messages && j.messages[0] && j.messages[0].id) || null, to: wto });
    } catch (e) { step.status = 'error'; step.detail = String(e.message || e).slice(0, 120); return JSON.stringify({ error: 'Network error: ' + String(e.message || e) }); }
  }
  if (name === 'connect_ai_brain') {
    epName = null;
    const prov = String(args.provider || '').toLowerCase().trim();
    const key = String(args.api_key || '').trim();
    if (!prov || !key) { step.status = 'error'; step.detail = 'provider + api_key chahiye'; return JSON.stringify({ error: 'provider aur api_key dono chahiye' }); }
    const P = BRAIN_PROVIDERS[prov];
    if (!P) { step.status = 'error'; step.detail = 'unknown provider ' + prov; return JSON.stringify({ error: 'Unknown provider: ' + prov }); }
    let burl = P.url;
    if (prov === 'custom') {
      burl = String(args.base_url || '').replace(/\/+$/, '');
      if (!burl) { step.status = 'error'; step.detail = 'custom ko base_url chahiye'; return JSON.stringify({ error: 'Custom provider ke liye base_url chahiye' }); }
    }
    await vault.saveCredential('BRAIN_PROVIDER', prov, 'AI brain provider (chat se connected)', uid);
    await vault.saveCredential('BRAIN_API_KEY', key, 'AI brain API key', uid);
    await vault.saveCredential('BRAIN_BASE_URL', burl, 'AI brain base URL', uid);
    await vault.deleteCredential('BRAIN_MODEL', uid).catch(() => {});
    if (args.model) await vault.saveCredential('BRAIN_MODEL', String(args.model).trim(), 'AI brain model', uid);
    const masked = key.slice(0, 4) + '...' + key.slice(-4);
    step.status = 'done'; step.detail = P.label + ' connected (' + masked + ')';
    return JSON.stringify({ ok: true, connected: true, provider: prov, label: P.label, model: args.model || P.model, masked, note: 'Ab se agent isi AI se sochega. Settings wali key ab override hai. Wapas settings wala brain chahiye to BRAIN_API_KEY delete karo.' });
  }
  if (name === 'mcp_list_servers') { epName = null; const r = await mcpApi('list', {}, uid); step.status = r.error ? 'error' : 'done'; step.detail = r.error ? String(r.error).slice(0, 120) : ((r.servers || []).length + ' servers'); return JSON.stringify(r); }
  if (name === 'mcp_test_server') { epName = null; const r = await mcpApi('test', { name: args.server, url: args.url }, uid); step.status = r.error ? 'error' : 'done'; step.detail = r.error ? String(r.error).slice(0, 120) : ((r.tools || []).length + ' tools mile'); return JSON.stringify(r); }
  if (name === 'mcp_call_tool') { epName = null; const r = await mcpApi('call', { name: args.server, tool: args.tool, args: args.args || {} }, uid); step.status = r.ok === false || r.error ? 'error' : 'done'; step.detail = r.error ? String(r.error).slice(0, 120) : 'complete'; return JSON.stringify(r); }
  if (name === 'list_automations') { epName = 'automations'; body = { action: 'list' }; }
  if (name === 'delete_automation') { epName = 'automations'; body = { action: 'delete', id: args.id }; }
  if (epName && uid && uid !== 'owner') body.user_id = uid; // github/notion/stripe waghera bhi user-scoped vault padhein
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

  const { message, history, api_key, provider, model, device_id, user_id, access_token } = req.body || {};
  // har user ka apna credential vault. Google login (Supabase auth) ho to access_token
  // verify karke REAL user id use hota hai - spoofing impossible.
  const authR = await auth.resolveUser(req, user_id || 'owner');
  const uid = authR.uid;

  // ---- OLLAMA (local PC) mode: bridge ke through local model ----
  if (provider === 'ollama') {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Ollama mode ke liye Supabase env vars chahiye (bridge system).' });
    }
    const devAll = await getOnlineDevice(uid);
    const devices = devAll ? [devAll] : [];
    if (!devices.length) return res.status(400).json({ error: 'Koi device connected nahi. Laptop: Desktop app / Connect PC. Android: Terminal > Termux setup. (Ollama us device pe hona chahiye.)' });
    const device = devices[0];
    const chosenModel = model || (device.ollama_models && device.ollama_models[0]);
    if (!chosenModel) return res.status(400).json({ error: 'Is PC pe koi Ollama model nahi mila. "ollama pull llama3.2" chalao.' });
    const jobId = await createBridgeJob(device.id, 'ollama_chat', { model: chosenModel, messages: [
      { role: 'system', content: 'You are Dev Craft Agent. Reply in the same language the user uses (Urdu/Roman Urdu mix is fine). Be helpful, concise.' },
      ...(Array.isArray(history) ? history.slice(-8).map(h => ({ role: h.role, content: h.content })) : []),
      { role: 'user', content: message }
    ] }, uid);
    if (!jobId) return res.status(500).json({ error: 'Job create nahi hua (bridge_jobs table hai?)' });
    const result = await waitBridgeJob(jobId, 45000, uid);
    if (result === null) return res.status(504).json({ error: 'PC se jawab nahi aaya - bridge/Ollama chal raha hai?' });
    if (result.error) return res.status(500).json({ error: 'Ollama error: ' + result.error });
    return res.json({ reply: result.reply || '(khali jawab)', steps: [{ title: '🦙 Local Ollama se jawab (' + chosenModel + ')', status: 'done', detail: device.device_name }], links: [] });
  }

  // ---- VAULT BRAIN: chat se connected AI brain (Settings pe override) ----
  let effProvider = provider, effKey = api_key, effModel = model, effBaseURL = req.body.base_url;
  const vBrainKey = await vault.getCredential('BRAIN_API_KEY', uid);
  if (vBrainKey) {
    effKey = vBrainKey;
    effProvider = (await vault.getCredential('BRAIN_PROVIDER', uid)) || 'custom';
    effBaseURL = await vault.getCredential('BRAIN_BASE_URL', uid);
    effModel = await vault.getCredential('BRAIN_MODEL', uid) || (BRAIN_PROVIDERS[effProvider] ? BRAIN_PROVIDERS[effProvider].model : undefined);
  }

  // ---- provider resolve ----
  let baseURL = effBaseURL || (BRAIN_PROVIDERS[effProvider] ? BRAIN_PROVIDERS[effProvider].url : null);
  if (effProvider === 'custom') {
    baseURL = String(baseURL || '').replace(/\/+$/, '');
    if (!baseURL) return res.status(400).json({ error: 'Custom API ke liye base URL chahiye' });
  }
  // ---- GEMINI FALLBACK: koi personal key nahi to GEMINI_API_KEY env se chalo (user ki marzi: Gemini brain) ----
  if (!effKey && !api_key && process.env.GEMINI_API_KEY) {
    effProvider = 'gemini';
    effKey = process.env.GEMINI_API_KEY;
    effModel = BRAIN_PROVIDERS.gemini.model;
    baseURL = BRAIN_PROVIDERS.gemini.url;
  }
  const userKey = effKey || process.env.OPENAI_API_KEY;
  if (!userKey) {
    return res.status(500).json({ error: 'API key missing - Settings (menu > Settings) mein apni personal API key paste karo (OpenAI / OpenRouter / Custom), ya Vercel pe GEMINI_API_KEY / OPENAI_API_KEY set karo. Ya chat mein koi AI ki key de kar bolo "connect as AI brain".' });
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
        model: effModel || (BRAIN_PROVIDERS[effProvider] ? BRAIN_PROVIDERS[effProvider].model : null) || process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages, tools: TOOLS, max_tokens: 1500,
      });
      const msg = completion.choices[0].message;
      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const result = await runTool(tc.function.name, args, steps, uid);
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
