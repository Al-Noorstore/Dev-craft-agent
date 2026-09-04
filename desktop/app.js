// ============================================
// DEV CRAFT AGENT - DESKTOP APP (OpenClaw-style)
// Zero dependencies! Sirf Node.js 18+ chahiye.
// Chalao:  node app.js   →  http://localhost:3155 khud khul jayega
//
// POWERS (ye sab tumhare PC pe, tumhari permission se):
//   - Terminal commands (koi bhi)
//   - Files/folders: read, write, edit, DELETE
//   - Apps: open, close (kill)
//   - YouTube: open, search, close
//   - Local Ollama models (free AI) ya apni OpenAI key
// ============================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = 3155;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ---------- helpers ----------
function sh(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    exec(command, { timeout: Math.min(timeoutMs || 30000, 600000), maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, output: (stdout || '').slice(0, 6000), error: (stderr || '').slice(0, 2000) || (err ? err.message : ''), exit: err ? (err.code || 1) : 0 });
    });
  });
}
function openTarget(target) {
  if (IS_WIN) return sh('start "" "' + target.replace(/"/g, '') + '"', 8000);
  if (IS_MAC) return sh('open "' + target.replace(/"/g, '') + '"', 8000);
  return sh('xdg-open "' + target.replace(/"/g, '') + '"', 8000);
}
function killProcess(name) {
  const n = name.trim();
  if (IS_WIN) {
    const withExe = n.toLowerCase().endsWith('.exe') ? n : n + '.exe';
    return sh('taskkill /F /IM "' + withExe + '"', 10000);
  }
  return sh('pkill -f "' + n + '"', 10000);
}

// ---------- TOOLS (OpenClaw powers) ----------
const TOOLS = [
  { type: 'function', function: { name: 'run_command', description: 'Laptop ke terminal mein koi bhi command chalao (npm, git, dir/ls, ping, python - anything). Output wapas milta hai.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'terminal command' }, cwd: { type: 'string', description: 'working directory (optional)' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'file_write', description: 'File banao ya edit karo - poora content likho. Kisi bhi folder mein.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'file_read', description: 'Kisi bhi file ka content padho', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_list', description: 'Folder ka content dekho (files/subfolders)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'folder path, e.g. C:\\Users\\Noora\\Downloads ya ~/Documents' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'file_delete', description: 'File YA folder delete karo (permanently!). Bade/risky delete se pehle user se CONFIRM karo.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'folder_create', description: 'Naya folder banao', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'open_app', description: 'App, file ya website kholo. Examples: "notepad", "C:\\Program Files\\...\\app.exe", "https://youtube.com", koi bhi file.', parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] } } },
  { type: 'function', function: { name: 'close_app', description: 'App band karo (process kill). Process name do, e.g. "notepad", "chrome", "vlc".', parameters: { type: 'object', properties: { process_name: { type: 'string' } }, required: ['process_name'] } } },
  { type: 'function', function: { name: 'youtube', description: 'YouTube control karo: search, video open, ya YouTube band karo.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['search', 'open', 'close'], description: 'search = YouTube pe search karo (query do), open = video/channel URL kholo (url do), close = YouTube browser tab/app band' }, query: { type: 'string' }, url: { type: 'string' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'system_info', description: 'PC ki info: OS, RAM, disk, current user, IP', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'android_project', description: 'Android ka poora kaam: SDK check karo, NAYA project banao, PURANA project build karo (APK ban jayegi). SDK/JDK/Gradle missing ho to user ko install steps batao.', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['check', 'create', 'build'], description: 'check = SDK/JDK/Gradle detect karo; create = naya project template banao; build = gradle se APK banao' }, name: { type: 'string', description: 'project name (create ke liye)' }, package: { type: 'string', description: 'package id, e.g. com.devcraft.myapp' }, path: { type: 'string', description: 'project folder path (build/create ke liye)' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'package_app', description: 'Folder/app ko CONVERT karo: to_exe = folder ya Node/Python script ko EXE banao; to_apk = Android project ya HTML/website folder ko APK banao (HTML folder ka WebView wrapper app banega).', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['to_exe', 'to_apk'], description: 'to_exe = standalone EXE; to_apk = APK build/convert' }, path: { type: 'string', description: 'folder ya file ka path' }, entry: { type: 'string', description: '(to_exe) main script file, e.g. app.js ya main.py' }, name: { type: 'string', description: '(to_apk) app ka naam' }, package: { type: 'string', description: '(to_apk) package id' } }, required: ['action', 'path'] } } }
];

const SYSTEM_PROMPT = `You are Dev Craft Agent DESKTOP - running directly on the user's own laptop/PC (OpenClaw-style power user assistant). You have FULL tools:
- run_command (terminal), file_write/file_read/file_list/file_delete/folder_create (file system), open_app/close_app (apps), youtube (search/open/close), system_info.

RULES:
1. User Roman Urdu/Urdu/English mein baat karega - usi language mein jawab do (Roman Urdu mix theek hai).
2. Jaldi kaam karo - tools use karo, sirf advice nahi.
3. DESTRUCTIVE kaam (file_delete, format, rm -rf, mass delete) se pehle EK baar confirm karo: "ye delete karun? [haan/na]".
4. Commands ke liye OS ke mutabiq commands use karo (Windows: dir, taskkill; Linux/Mac: ls, pkill). User ka OS: __OS__.
5. Har tool ke result ke baad chhota summary do. Final reply concise rakho.
6. YouTube search: youtube tool {action:"search", query}. App kholna: open_app. Band karna: close_app (process name).
7. File paths mein spaces ho to quotes use karo.\n8. ANDROID: android_project tool use karo - pehle action check se SDK/JDK/Gradle verify karo, phir create se naya project banao, file_write se purana project EDIT karo, phir build se APK banao (build 5-10 min lag sakta hai).\n9. CONVERT/PACKAGE (package_app tool): folder ya script ko EXE banao (Node -> pkg, Python -> pyinstaller, koi bhi folder -> 7-Zip self-extracting EXE). Website/HTML folder ko APK banao (WebView wrapper + gradle build). Bade builds mein timeout 600 use karo.`.replace('__OS__', IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux');

function cd(d) { return (IS_WIN ? 'cd /d "' + d + '" && ' : 'cd "' + d + '" && '); }

// ---------- tool executor ----------
async function runTool(name, args, steps) {
  let title = name, result = {};
  try {
    if (name === 'run_command') { title = '⌨ Terminal: ' + String(args.command || '').slice(0, 50); result = await sh(args.command, (args.timeout || 60) * 1000); }
    else if (name === 'file_write') { fs.mkdirSync(path.dirname(args.path), { recursive: true }); fs.writeFileSync(args.path, args.content || '', 'utf8'); result = { ok: true, saved: args.path }; title = '📝 File likhi: ' + path.basename(args.path); }
    else if (name === 'file_read') { result = { content: fs.readFileSync(args.path, 'utf8').slice(0, 8000) }; title = '📖 File padhi: ' + path.basename(args.path); }
    else if (name === 'file_list') { const list = fs.readdirSync(args.path).slice(0, 200).map(f => { try { return f + (fs.statSync(path.join(args.path, f)).isDirectory() ? '/' : ''); } catch { return f; } }); result = { files: list }; title = '📂 Folder dekha: ' + path.basename(args.path || args.path); }
    else if (name === 'file_delete') {
      if (!fs.existsSync(args.path)) { result = { error: 'Path nahi mila: ' + args.path }; }
      else { fs.rmSync(args.path, { recursive: true, force: true }); result = { ok: true, deleted: args.path }; title = '🗑 Delete kiya: ' + path.basename(args.path); }
    }
    else if (name === 'folder_create') { fs.mkdirSync(args.path, { recursive: true }); result = { ok: true, created: args.path }; title = '📂 Folder banaya'; }
    else if (name === 'open_app') { result = await openTarget(args.target); title = '🚀 Khol diya: ' + String(args.target).slice(0, 50); }
    else if (name === 'close_app') { result = await killProcess(args.process_name); title = '🚫 Band kiya: ' + args.process_name; }
    else if (name === 'youtube') {
      if (args.action === 'search') { result = await openTarget('https://www.youtube.com/results?search_query=' + encodeURIComponent(args.query || '')); title = '📺 YouTube search: ' + (args.query || '').slice(0, 40); }
      else if (args.action === 'open') { result = await openTarget(args.url || 'https://youtube.com'); title = '📺 YouTube khola'; }
      else { result = await killProcess(IS_WIN ? 'chrome' : 'firefox'); title = '📺 YouTube/browser band'; }
    }
    else if (name === 'system_info') { result = { os: os.type() + ' ' + os.release(), hostname: os.hostname(), user: os.userInfo().username, cpu: os.cpus()[0] && os.cpus()[0].model, ram_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024), freemem_gb: Math.round(os.freemem() / 1024 / 1024 / 1024), uptime_h: Math.round(os.uptime() / 3600) }; title = '💻 System info'; }
    else if (name === 'android_project') {
      const home = os.homedir();
      const sdkDir = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
        (IS_WIN ? path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') :
         fs.existsSync(path.join(home, 'Android', 'Sdk')) ? path.join(home, 'Android', 'Sdk') :
         fs.existsSync(path.join(home, 'android-sdk')) ? path.join(home, 'android-sdk') : null);
      if (args.action === 'check') {
        title = '🤖 Android SDK check';
        const java = await sh('java -version 2>&1', 10000);
        const gradle = await sh((IS_WIN ? 'gradle.bat' : 'gradle') + ' --version 2>&1 | head -5', 15000);
        const adb = sdkDir ? await sh('"' + path.join(sdkDir, 'platform-tools', IS_WIN ? 'adb.exe' : 'adb') + '" version', 10000) : { ok: false, error: 'not found' };
        result = {
          jdk: java.ok ? (java.output || java.error).split('\n')[0] : 'Java nahi mila - JDK 17 install karo',
          jdk_ok: java.ok,
          gradle: gradle.ok ? ((gradle.output || '').split('\n').filter(l => l.includes('Gradle'))[0] || 'found') : 'Gradle nahi mila - gradle.org ya choco/brew se install karo',
          gradle_ok: gradle.ok,
          sdk: sdkDir && fs.existsSync(sdkDir) ? 'OK ' + sdkDir : 'Android SDK nahi mila - Android Studio install karo (developer.android.com)',
          sdk_ok: !!(sdkDir && fs.existsSync(sdkDir)),
          adb: adb.ok ? 'adb ready' : 'adb nahi mila',
          summary: 'APK build ke liye: JDK 17 + Android SDK + Gradle chahiye. Missing cheezon ke install commands bhi bata sakta hoon.'
        };
      } else if (args.action === 'create') {
        const appName = (args.name || 'MyApp').replace(/[^a-zA-Z0-9]/g, '') || 'MyApp';
        const pkg = args.package || ('com.devcraft.' + appName.toLowerCase());
        const dir = args.path || path.join(home, 'DevCraftApps', appName);
        const T = {
          'settings.gradle': 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name = "' + appName + '"\ninclude \'' + 'app' + '\'\n',
          'build.gradle': 'plugins { id "com.android.application" version "8.5.2" apply false }\n',
          'gradle.properties': 'android.useAndroidX=true\norg.gradle.jvmargs=-Xmx2048m\n',
          'app/build.gradle': 'plugins { id "com.android.application" }\nandroid {\n  namespace "' + pkg + '"\n  compileSdk 34\n  defaultConfig { applicationId "' + pkg + '"; minSdk 21; targetSdk 34; versionCode 1; versionName "1.0" }\n  buildTypes { release { minifyEnabled false } }\n  compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }\n}\n',
          'app/src/main/AndroidManifest.xml': '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <application android:label="' + appName + '" android:icon="@android:drawable/ic_menu_compass" android:theme="@android:style/Theme.Material.Light.DarkActionBar">\n    <activity android:name=".MainActivity" android:exported="true">\n      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>\n    </activity>\n  </application>\n</manifest>\n',
          ['app/src/main/java/' + pkg.split('.').join('/') + '/MainActivity.java']: 'package ' + pkg + ';\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.widget.TextView;\npublic class MainActivity extends Activity {\n  @Override protected void onCreate(Bundle b) {\n    super.onCreate(b);\n    TextView tv = new TextView(this);\n    tv.setTextSize(22);\n    tv.setPadding(40, 120, 40, 40);\n    tv.setText("Hello! Ye app Dev Craft Agent ne banayi hai");\n    setContentView(tv);\n  }\n}\n'
        };
        for (const [f, c] of Object.entries(T)) {
          const fp = path.join(dir, f);
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, c, 'utf8');
        }
        if (sdkDir && fs.existsSync(sdkDir)) { fs.writeFileSync(path.join(dir, 'local.properties'), 'sdk.dir=' + sdkDir.replace(/\\/g, '/') + '\n', 'utf8'); }
        result = { ok: true, created: dir, package: pkg, files: Object.keys(T).length, note: sdkDir ? 'SDK mila - ab build action chalao' : 'SDK missing - pehle Android SDK install karo' };
        title = '🤖 Android project banaya: ' + appName;
      } else if (args.action === 'build') {
        const dir = args.path;
        title = '🤖 APK build: ' + path.basename(dir || '');
        if (!dir || !fs.existsSync(dir)) { result = { error: 'Project folder nahi mila: ' + dir }; }
        else {
          if (sdkDir && fs.existsSync(sdkDir) && !fs.existsSync(path.join(dir, 'local.properties'))) fs.writeFileSync(path.join(dir, 'local.properties'), 'sdk.dir=' + sdkDir.replace(/\\/g, '/') + '\n', 'utf8');
          const gradleCmd = IS_WIN ? 'gradle.bat' : 'gradle';
          const w = await sh(cd(dir) + gradleCmd + ' wrapper --gradle-version 8.7', 180000);
          if (!w.ok) result = { error: 'Gradle wrapper fail: ' + (w.error || w.output).slice(0, 300), tip: 'gradle install hai? android_project check chalao' };
          else {
            const buildCmd = IS_WIN ? 'gradlew.bat assembleDebug' : './gradlew assembleDebug';
            const b = await sh(cd(dir) + buildCmd, 600000);
            const apk = path.join(dir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
            result = b.ok && fs.existsSync(apk)
              ? { ok: true, apk: apk, size_mb: Math.round(fs.statSync(apk).size / 1024 / 1024 * 10) / 10, log_tail: (b.output || '').split('\n').slice(-5).join('\n') }
              : { error: 'Build fail: ' + ((b.error || b.output || '').split('\n').slice(-8).join('\n')).slice(0, 400), tip: 'android_project check chala ke SDK/JDK verify karo' };
          }
        }
      } else { result = { error: 'action: check | create | build' }; }
    }
    else if (name === 'package_app') {
      const home = os.homedir();
      const target = args.path;
      if (!target || !fs.existsSync(target)) { result = { error: 'Path nahi mila: ' + target }; }
      else if (args.action === 'to_exe') {
        title = '📦 EXE ban rahi hai: ' + path.basename(target);
        const isDir = fs.statSync(target).isDirectory();
        let entry = args.entry ? path.join(isDir ? target : path.dirname(target), args.entry) : null;
        if (isDir && !entry) for (const c of ['app.js', 'index.js', 'main.js']) { const f = path.join(target, c); if (fs.existsSync(f)) { entry = f; break; } }
        if (entry && fs.existsSync(entry) && entry.endsWith('.js')) {
          // Node script -> standalone EXE (pkg)
          const out = path.join(isDir ? target : path.dirname(target), path.basename(entry, '.js') + (IS_WIN ? '.exe' : '-bin'));
          const r = await sh('npx --yes pkg "' + entry + '" --output "' + out + '"', 420000);
          result = r.ok && fs.existsSync(out)
            ? { ok: true, exe: out, size_mb: Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10, note: 'Standalone EXE - Node install kiye bina chalegi (same OS pe)' }
            : { error: 'pkg se EXE nahi bani: ' + (r.error || r.output || '').split('\n').slice(-4).join(' ').slice(0, 300), tip: 'Alternatives: "npm i -g pkg" try karo, ya pyinstaller (python), ya 7-Zip SFX (folder)' };
        } else if (entry && fs.existsSync(entry) && entry.endsWith('.py')) {
          const r = await sh('pip install pyinstaller --quiet && pyinstaller --onefile "' + entry + '" --distpath "' + (isDir ? target : path.dirname(target)) + '"', 420000);
          const out = path.join(isDir ? target : path.dirname(target), path.basename(entry, '.py') + (IS_WIN ? '.exe' : ''));
          result = r.ok && fs.existsSync(out) ? { ok: true, exe: out } : { error: 'PyInstaller fail: ' + (r.error || '').slice(0, 200), tip: 'pip install pyinstaller' };
        } else {
          // Koi bhi folder -> self-extracting EXE (7-Zip SFX)
          const z7 = (await sh(IS_WIN ? 'where 7z 2>nul || echo "%ProgramFiles%\\7-Zip\\7z.exe"' : 'which 7z 7za 2>/dev/null', 8000));
          const z7path = (z7.output || '').split('\n')[0].replace(/^"|"$/g, '').trim();
          if (z7path && fs.existsSync(z7path)) {
            const out = target.replace(/[\\/]$/, '') + '.exe';
            const r = await sh('"' + z7path + '" a -sfx "' + out + '" "' + target + '"', 300000);
            result = r.ok && fs.existsSync(out) ? { ok: true, exe: out, size_mb: Math.round(fs.statSync(out).size / 1024 / 1024 * 10) / 10, note: 'Self-extracting EXE - double-click se folder khud extract hoga' } : { error: '7z SFX fail: ' + (r.error || '').slice(0, 200) };
          } else {
            result = { error: '7-Zip nahi mila', tip: IS_WIN ? 'Install: winget install 7zip.7zip (ya 7-zip.org) phir dobara try karo' : 'Install: sudo apt install p7zip-full' };
          }
        }
      } else if (args.action === 'to_apk') {
        const isAndroid = fs.existsSync(path.join(target, 'app', 'src', 'main', 'AndroidManifest.xml'));
        if (isAndroid) {
          title = '📦 APK build (Android project)';
          result = JSON.parse(await runTool('android_project', { action: 'build', path: target }, steps));
          if (result.ok) title = '📦 APK ban gayi: ' + (result.size_mb || '?') + ' MB';
        } else {
          // HTML/website folder -> WebView wrapper app -> APK
          title = '📦 HTML folder → APK (WebView app)';
          const htmlOk = fs.existsSync(path.join(target, 'index.html')) || (fs.readdirSync(target).some(f => f.endsWith('.html')));
          if (!htmlOk) { result = { error: 'Is folder mein HTML file nahi milo - website folder do (index.html wala) ya Android project folder' }; }
          else {
            const appName = (args.name || path.basename(target)).replace(/[^a-zA-Z0-9]/g, '') || 'WebApp';
            const pkg = args.package || ('com.devcraft.' + appName.toLowerCase());
            const dir = path.join(home, 'DevCraftApps', appName + '-apk');
            const T = {
              'settings.gradle': 'pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositories { google(); mavenCentral() } }\nrootProject.name = "' + appName + '"\ninclude \'' + 'app' + '\'\n',
              'build.gradle': 'plugins { id "com.android.application" version "8.5.2" apply false }\n',
              'gradle.properties': 'android.useAndroidX=true\n',
              'app/build.gradle': 'plugins { id "com.android.application" }\nandroid {\n  namespace "' + pkg + '"\n  compileSdk 34\n  defaultConfig { applicationId "' + pkg + '"; minSdk 21; targetSdk 34; versionCode 1; versionName "1.0" }\n  buildTypes { release { minifyEnabled false } }\n  compileOptions { sourceCompatibility JavaVersion.VERSION_17; targetCompatibility JavaVersion.VERSION_17 }\n}\n',
              'app/src/main/AndroidManifest.xml': '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n  <uses-permission android:name="android.permission.INTERNET"/>\n  <application android:label="' + appName + '" android:icon="@android:drawable/ic_menu_compass" android:theme="@android:style/Theme.Material.Light.NoActionBar">\n    <activity android:name=".MainActivity" android:exported="true" android:configChanges="orientation|screenSize">\n      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>\n    </activity>\n  </application>\n</manifest>\n',
              ['app/src/main/java/' + pkg.split('.').join('/') + '/MainActivity.java']: 'package ' + pkg + ';\nimport android.app.Activity;\nimport android.os.Bundle;\nimport android.webkit.WebView;\nimport android.webkit.WebViewClient;\npublic class MainActivity extends Activity {\n  WebView wv;\n  @Override protected void onCreate(Bundle b) {\n    super.onCreate(b);\n    wv = new WebView(this);\n    wv.getSettings().setJavaScriptEnabled(true);\n    wv.getSettings().setDomStorageEnabled(true);\n    wv.setWebViewClient(new WebViewClient());\n    wv.loadUrl("file:///android_asset/index.html");\n    setContentView(wv);\n  }\n  @Override public void onBackPressed() { if (wv != null && wv.canGoBack()) wv.goBack(); else super.onBackPressed(); }\n}\n'
            };
            for (const [f, c] of Object.entries(T)) { const fp = path.join(dir, f); fs.mkdirSync(path.dirname(fp), { recursive: true }); fs.writeFileSync(fp, c, 'utf8'); }
            // HTML folder -> assets mein copy (node_modules/.git skip)
            const assets = path.join(dir, 'app', 'src', 'main', 'assets');
            fs.mkdirSync(assets, { recursive: true });
            const skip = new Set(['node_modules', '.git', '.gradle', 'build']);
            (function copy(src, dstp) {
              for (const item of fs.readdirSync(src)) {
                if (skip.has(item)) continue;
                const sp = path.join(src, item), dp = path.join(dstp, item);
                if (fs.statSync(sp).isDirectory()) { fs.mkdirSync(dp, { recursive: true }); copy(sp, dp); }
                else fs.copyFileSync(sp, dp);
              }
            })(target, assets);
            result = { ok: true, project: dir, note: 'WebView app ban gayi - ab build chal rahi hai...' };
            const build = JSON.parse(await runTool('android_project', { action: 'build', path: dir }, steps));
            result = build.ok ? build : Object.assign({ wrapper: dir }, build);
            if (build.ok) title = '📦 APK ban gayi: ' + (build.size_mb || '?') + ' MB';
          }
        }
      } else { result = { error: 'action: to_exe | to_apk' }; }
    }
    else { result = { error: 'Unknown tool: ' + name }; }
  } catch (e) { result = { error: e.message }; }
  steps.push({ title, status: result && result.error && !result.ok ? 'error' : 'done', detail: (result && (result.output || result.error || result.saved || result.deleted || result.created || '') || '').toString().split('\n')[0].slice(0, 60) });
  return JSON.stringify(result);
}

// ---------- chat (OpenAI ya local Ollama) ----------
async function chat(req, res, body) {
  res.setHeader('Content-Type', 'application/json');
  const { message, history, api_key, provider, model, base_url } = body || {};
  if (!message) return res.end(JSON.stringify({ error: 'message required' }));
  const steps = [];

  // ---- bonus: "$ cmd" pattern → seedha terminal (bina AI ke bhi chale) ----
  const cmdMatch = message.match(/^\s*(?:\$|cmd:|terminal:)\s*(.+)/i);
  if (cmdMatch) {
    const out = await sh(cmdMatch[1]);
    steps.push({ title: '⌨ Terminal (direct)', status: out.ok ? 'done' : 'error', detail: (out.output || out.error || 'done').split('\n')[0].slice(0, 60) });
    return res.end(JSON.stringify({ reply: '```\n' + (out.output || out.error || '(no output)') + '\n```', steps }));
  }

  // ---- Ollama (local, free) ----
  if (provider === 'ollama') {
    try {
      const r = await fetch('http://localhost:11434/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model || 'llama3.2', messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...(Array.isArray(history) ? history.slice(-8) : []), { role: 'user', content: message }], stream: false }) });
      if (!r.ok) return res.end(JSON.stringify({ error: 'Ollama error (HTTP ' + r.status + ') - model installed? "ollama pull llama3.2"' }));
      const d = await r.json();
      return res.end(JSON.stringify({ reply: (d.message && d.message.content) || '', steps }));
    } catch (e) { return res.end(JSON.stringify({ error: 'Ollama nahi chal raha (localhost:11434). ollama.com se install karo ya Settings mein OpenAI key use karo.' })); }
  }

  // ---- OpenAI / OpenRouter / Custom (OpenAI-compatible) ----
  const BRAIN_URL = provider === 'openrouter' ? 'https://openrouter.ai/v1/chat/completions'
    : provider === 'custom' ? (base_url || '').replace(/\/+$/, '') + '/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const brainModel = model || (provider === 'openrouter' ? 'openrouter/auto' : provider === 'custom' ? 'custom-model' : 'gpt-4o-mini');
  if (!api_key) return res.end(JSON.stringify({ error: 'API key missing - Settings (⚙️) mein apni API key paste karo (OpenAI/OpenRouter/Custom), ya Ollama select karo (free).' }));
  if (provider === 'custom' && !base_url) return res.end(JSON.stringify({ error: 'Custom API ke liye Base URL Settings mein daalo' }));
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...(Array.isArray(history) ? history.slice(-10) : []), { role: 'user', content: message }];
  try {
    let reply = '';
    for (let round = 0; round < 8; round++) {
      const r = await fetch(BRAIN_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key },
        body: JSON.stringify({ model: brainModel, messages, tools: TOOLS, max_tokens: 1600 })
      });
      if (!r.ok) { const errTxt = await r.text(); return res.end(JSON.stringify({ error: 'OpenAI error: ' + errTxt.slice(0, 200) })); }
      const d = await r.json();
      const msg = d.choices[0].message;
      if (msg.tool_calls && msg.tool_calls.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) {}
          const result = await runTool(tc.function.name, args, steps);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 6000) });
        }
        continue;
      }
      reply = msg.content || '';
      break;
    }
    return res.end(JSON.stringify({ reply: reply || 'Kaam ho gaya 👆 (steps upar)', steps }));
  } catch (e) { return res.end(JSON.stringify({ error: 'Network error: ' + e.message })); }
}

// ---------- server ----------
const HTML = fs.existsSync(path.join(__dirname, 'desktop.html')) ? fs.readFileSync(path.join(__dirname, 'desktop.html'), 'utf8') : '<h1>desktop.html missing!</h1>';

// ---------- SELF-TEST MODE: node app.js --test ----------
async function selfTest() {
  console.log('=== DEV CRAFT AGENT SELF-TEST ===\n');
  const results = [];
  const T = async (name, fn) => {
    try { const detail = await fn(); results.push({ name, ok: true, detail: detail || '' }); console.log('  PASS  ' + name + (detail ? '  - ' + detail : '')); }
    catch (e) { results.push({ name, ok: false, detail: String(e.message || e).slice(0, 80) }); console.log('  FAIL  ' + name + '  - ' + String(e.message || e).slice(0, 80)); }
  };
  const assert = (c, msg) => { if (!c) throw new Error(msg || 'assert fail'); };

  const home = os.homedir(), tmp = path.join(home, 'devcraft-test-' + Date.now());
  await T('terminal command (echo)', async () => {
    const r = await sh('echo hello-test', 10000);
    assert(r.ok && (r.output || '').includes('hello-test'), JSON.stringify(r).slice(0, 100));
    return 'echo works';
  });
  await T('file_write + read + edit + delete', async () => {
    const steps = [];
    const r1 = JSON.parse(await runTool('file_write', { path: path.join(tmp, 'sub', 't.txt'), content: 'line1' }, steps));
    const r2 = JSON.parse(await runTool('file_read', { path: path.join(tmp, 'sub', 't.txt') }, steps));
    JSON.parse(await runTool('file_write', { path: path.join(tmp, 'sub', 't.txt'), content: 'line1\nline2-EDITED' }, steps));
    const r4 = JSON.parse(await runTool('file_read', { path: path.join(tmp, 'sub', 't.txt') }, steps));
    const r5 = JSON.parse(await runTool('file_delete', { path: path.join(tmp, 'sub', 't.txt') }, steps));
    assert(r1.ok && r2.content === 'line1' && r4.content.includes('EDITED') && r5.ok, 'r1=' + JSON.stringify(r1) + ' r2=' + JSON.stringify(r2) + ' r4=' + JSON.stringify(r4).slice(0,50) + ' r5=' + JSON.stringify(r5));
    return 'CRUD ok';
  });
  await T('folder create + list + delete', async () => {
    const steps = [];
    const r1 = JSON.parse(await runTool('file_write', { path: path.join(tmp, 'a', 'b', 'c.txt'), content: 'x' }, steps));
    JSON.parse(await runTool('file_list', { path: tmp }, steps));
    const r3 = JSON.parse(await runTool('file_delete', { path: tmp }, steps));
    assert(r1.ok && r3.ok, 'folder ops fail');
    return 'ok';
  });
  await T('system_info', async () => {
    const steps = [];
    const r = JSON.parse(await runTool('system_info', {}, steps));
    assert(r.os, 'info missing');
    return (r.os || '').slice(0, 40);
  });
  await T('android SDK check', async () => {
    const steps = [];
    const r = JSON.parse(await runTool('android_project', { action: 'check' }, steps));
    return 'JDK:' + (r.jdk_ok ? 'OK' : 'nahi') + ' SDK:' + (r.sdk_ok ? 'OK' : 'nahi') + ' Gradle:' + (r.gradle_ok ? 'OK' : 'nahi');
  });
  await T('Ollama (optional)', async () => {
    const r = await sh('ollama list 2>/dev/null', 8000);
    return r.ok ? 'models mil gaye' : 'skip - ollama install nahi (optional)';
  });
  await T('7-Zip (exe ke liye, optional)', async () => {
    const r = await sh(IS_WIN ? 'where 7z' : 'which 7z 7za', 5000);
    return r.ok ? '7z mila - SFX exe possible' : 'skip - 7-Zip install nahi (optional)';
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  const pass = results.filter(r => r.ok).length;
  console.log('\n=== RESULT: ' + pass + '/' + results.length + ' PASS ===');
  console.log('AI brain alag test: app chalao (node app.js) > browser > message bhejo');
  process.exit(results.some(r => !r.ok) ? 1 : 0);
}
if (process.argv.includes('--test')) { selfTest(); return; }

http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(HTML); }
  if (req.method === 'POST') {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(buf || '{}'); } catch (e) {}
      if (req.url === '/api/chat') return chat(req, res, body);
      if (req.url === '/api/models') {
        try { const r = await fetch('http://localhost:11434/api/tags'); const d = await r.json(); return res.end(JSON.stringify({ models: (d.models || []).map(m => m.name) })); }
        catch (e) { return res.end(JSON.stringify({ models: [] })); }
      }
      if (req.url === '/api/ping') return res.end(JSON.stringify({ ok: true, app: 'Dev Craft Desktop v1', os: os.type() }));
      res.statusCode = 404; res.end('{}');
    });
    return;
  }
  res.statusCode = 404; res.end();
}).listen(PORT, async () => {
  console.log('\n⚡ DEV CRAFT AGENT - DESKTOP v1');
  console.log('   ➜ Browser mein kholo: http://localhost:' + PORT);
  console.log('   ' + (IS_WIN ? 'OS: Windows' : IS_MAC ? 'OS: macOS' : 'OS: Linux') + ' | User: ' + os.userInfo().username);
  console.log('\n   Powers: terminal ✅ files/folders edit+delete ✅ apps open/close ✅ YouTube ✅');
  console.log('   AI: Settings mein OpenAI key ya local Ollama (free)\n');
  try { await openTarget('http://localhost:' + PORT); console.log('   Browser khul gaya! (na khula to manually kholo)'); } catch (e) {}
});

// (test export - production mein koi asar nahi)
if (process.env.DCD_EXPORT) module.exports = { runTool, selfTest };
