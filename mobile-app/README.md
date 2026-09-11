# Dev Craft Agent — Mobile (Android APK)

Apna AI agent, apni APK — **apna terminal (Termux jaisa, bina Termux!)**

## Powers (native, permissions ke saath)
- 📞 `call <number>` — direct call (CALL_PHONE permission)
- 💬 `sms <num> <msg>` — SMS bhejo
- 🔦 `torch on/off` | `vibrate` | `speak <text>` (TTS) | `listen` (voice input)
- 📱 `apps` / `open <package>` — installed apps list + kholo
- 📁 Virtual file system: `ls cd cat write mkdir rm`
- ⚡ `js <code>` — real JavaScript engine (terminal ke andar)
- 🌐 `get <url>` — internet fetch | `ai <sawal>` — AI chat
- 🔑 OpenAI / OpenRouter / Custom (Groq etc.) — key phone pe hi rehti hai

## APK kaise banao (laptop agent se)
1. Ye repo laptop pe clone/download karo (ya GitHub se pull)
2. Desktop app (Dev Craft Agent v1.19+) mein bolo:
   > `mobile-app project ko APK banao`
3. Agent: SDK check → gradle build → `app-debug.apk` dega
4. APK phone pe transfer karo → install (Unknown sources allow) → done!

## Termux?
Zaroorat NAHI — apna terminal andar hai. Baad mein chaaho to
Termux se PC-bridge connect ka option bhi aa sakta hai (optional).
