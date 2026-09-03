# Dev Craft Agent 🤖 (v6 — FULL TOOLKIT)

AI Web Agency Assistant — 23 endpoints, live chat UI, voice, aur 14 tool integrations. GitHub pe push karo, Vercel pe FREE host karo.

## ⭐ LIVE CHAT — ChatGPT-style UI (mobile + laptop!)
Deploy ke baad apna Vercel URL kholo (phone ya laptop — dono pe perfect):
- 📱 **Responsive**: mobile pe hamburger ☰ menu, laptop pe full sidebar
- 💬 **Chat history**: saari purani chats sidebar mein save (browser storage)
- ＋ **New Chat button**: nayi conversation ek click mein
- 🎤 **Voice**: bol kar poocho, bot bol kar jawab de
- 📱 **Add to Home Screen**: mobile pe "Install app" karo — app jaisa lagta hai!
**Har user ka apna alag chat** — WhatsApp/Telegram pe bhi har client apne private chat mein baat karta hai, jaise real apps mein hota hai.

## All 17 Capabilities

| Endpoint | Kaam | Needs | Cost |
|---|---|---|---|
| 🌐 `public/index.html` | **LIVE CHAT UI + voice** | Kuch nahi | Free |
| `POST /api/chat` | 🤖 AI brain (10 skills) | OpenAI key | ~$5 |
| `POST /api/search` | 🔍 Google business search | Google Maps key | Free tier |
| `POST /api/audit` | 🩺 Website auditor | **Kuch nahi!** | Free |
| `POST /api/score` | ⭐ Lead scoring | OpenAI (optional) | Free-ish |
| `POST /api/draft-email` | ✍️ Email drafting | OpenAI key | ~$5 |
| `POST /api/send-email` | 📧 Email bhejna | Gmail App Password | Free |
| `GET /api/read-emails` | 📥 Inbox + AI classify | Gmail OAuth | Free |
| `GET/POST /api/leads` | 💾 Leads DB | Supabase | Free |
| `GET /api/report` | 📊 Daily 9AM PKT report | Supabase+Gmail | Free |
| `POST /api/stripe-payment` | 💳 Payment link banao | Stripe key | Free* |
| `POST /api/sheets` | 📗 Google Sheets row add | Service Account | Free |
| `POST /api/notion` | 📝 Notion entry | Notion token | Free |
| `POST /api/twitter` | 🐦 X pe leads dhundo | X API Basic | **$100/mo!** |
| `POST /api/slack` | 💼 Slack notification | Webhook | Free |
| `POST /api/discord` | 🎮 Discord notification | Webhook | Free |
| `POST /api/telegram` | ✈️ Telegram bot | @BotFather token | Free |
| `POST /api/drive` | ☁️ Drive: save/list/search/read files | Service Account | Free |
| `POST /api/github` | 🐙 Repo banao, files push karo | GitHub token | Free |
| `POST /api/gitlab` | 🦊 GitLab projects + push | GitLab token | Free |
| `POST /api/clone-site` | 📸 Website clone (single-file zip) | **Kuch nahi!** | Free |
| `POST /api/files` | 📂 unzip, CSV↔JSON, PDF read, image read (AI) | OpenAI (image only) | Free |
| `POST /api/exec` | ⚡ Commands run karo | **Self-hosted only!** | Free |

*Stripe: payment tabhi fees jab payment aaye.

## Credentials Guide (kahan se kya milega)

| Tool | Kahan banao | Kitna time |
|---|---|---|
| OpenAI | platform.openai.com/api-keys | 5 min |
| Google Maps | console.cloud.google.com → Places API | 10 min |
| WhatsApp | developers.facebook.com → WhatsApp | 30 min |
| Gmail SMTP | Google Account → Security → App Passwords | 5 min |
| Gmail OAuth | console.cloud.google.com → OAuth client | 20 min |
| Supabase | supabase.com → project + leads table | 10 min |
| Stripe | dashboard.stripe.com → test key pehle | 10 min |
| Google Sheets | Service Account + JSON key | 15 min |
| Notion | notion.so/my-integrations + DB connect | 10 min |
| Slack | api.slack.com/messaging/webhooks | 5 min |
| Discord | Channel → Integrations → Webhooks | 3 min |
| Telegram | @BotFather → /newbot | 2 min ⚡ |
| Google Drive | Service Account + Drive API enable | 15 min |
| GitHub | Settings > Developer settings > Tokens (repo scope) | 5 min |
| GitLab | Preferences > Access Tokens (api scope) | 5 min |
| Website Cloner | Kuch nahi! Bina key chalta hai | 0 min ⚡ |
| Twitter/X | developer.x.com | $100/mo ⚠️ |

## Setup (same 3 steps)

1. **GitHub**: Ye folder new repo mein upload karo
2. **Vercel**: Add New Project → repo select → jo tools use karne hain unke env vars daalo → Deploy
3. **Webhooks** (jo chahiye):
   - WhatsApp: Callback URL = `https://YOUR.vercel.app/api/whatsapp`
   - Telegram: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR.vercel.app/api/telegram`
   - Telegram sabse asaan hai — 2 minute mein bot live!

## Recommended order (ek waqt mein ek tool!)
1. Pehle: OpenAI + Telegram (sabse fast live chat)
2. Phir: Stripe (payments) + Supabase (leads)
3. Phir: Sheets/Notion/Slack/Discord (jaisa pasand ho)
4. Last mein: WhatsApp (Meta setup lamba hai), Twitter ($100)

## ⚡ Commands run karna (Solene jaisa) — self-hosted only
- **Vercel pe: NAHI** — cloud pe commands chalana kisi bhi system ke liye open risk hai (isliye default disabled)
- **Apne PC pe: HAAN!** — `EXEC_ENABLED=true npm run dev` (ya vercel dev) se chalao → `/api/exec` se `ls`, `node`, `git` — sab chalega
- Dangerous commands (rm -rf /, shutdown) blocked hain
- Best practice: `EXEC_TOKEN` bhi set karo

## ⚠️ Website Cloner — Legal Note
Clone sirf design-reference, backup, ya apni sites ke liye. Kisi ka copyrighted content copy karke apni site banana/ publish karna copyright infringement hai!

## Ethics built-in
No fake guarantees, no spam, no deceptive emails — code mein hard-coded hain.

## License
MIT
