// ============================================
// WEBSITE CLONER - /api/clone-site
// POST { "url": "https://example.com" }
// Website ka HTML utaar kar ek SINGLE self-contained file banata hai:
// CSS inline hota hai, images/links absolute URLs pe point karte hain
// Zip file base64 mein return hoti hai (save karke khol lo)
// FREE - koi API key nahi chahiye!
// NOTE: JavaScript-heavy sites (React etc.) ka design nahi aata —
// static sites (WordPress, HTML sites) best clone hote hain.
// Sirf apni ya client ki reference/design ke liye use karo —
// kisi ka copyrighted content copy karke publish karna illegal hai!
// ============================================
const JSZip = require('jszip');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    let { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'url is required' });
    if (!url.startsWith('http')) url = 'https://' + url;

    const fetchRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    let html = await fetchRes.text();
    const base = new URL(fetchRes.url);

    // 1. Absolute-ify links & images (site_break nahi hoga)
    html = html.replace(/(src|href)=["']([^"']+)["']/gi, (m, attr, val) => {
      if (/^(data:|https?:|mailto:|tel:|#|javascript:)/i.test(val)) return m;
      try { return `${attr}="${new URL(val, base).href}"`; } catch { return m; }
    });

    // 2. Inline external CSS (max 5 files)
    const links = [...html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].slice(0, 5);
    for (const l of links) {
      try {
        const cssUrl = new URL(l[1], base).href;
        const cssRes = await fetch(cssUrl, { signal: AbortSignal.timeout(8000) });
        let css = await cssRes.text();
        // CSS ke andar ke relative paths bhi absolute karo
        css = css.replace(/url\((['"]?)([^'")]+)(['"]?)\)/gi, (m, q1, val, q2) => {
          if (/^(data:|https?:)/i.test(val)) return m;
          try { return `url("${new URL(val, cssUrl).href}")`; } catch { return m; }
        });
        html = html.replace(l[0], `<style>\n${css}\n</style>`);
      } catch { /* CSS fetch fail = skip */ }
    }

    // 3. Scripts hatao (clone clean rehta hai)
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

    const domain = base.hostname.replace(/^www\./, '');

    // 4. Zip banao
    const zip = new JSZip();
    zip.file('index.html', html);
    zip.file('README.txt', `Clone of: ${base.href}\nCloned: ${new Date().toISOString()}\n\nKholne ka tareeqa: index.html ko browser mein kholo.\nWARNING: Ye clone sirf design-reference/backup ke liye hai. Kisi aur ka copyrighted content copy karke apni site pe publish karna illegal hai!`);
    const zipBuf = await zip.generateAsync({ type: 'base64' });

    res.json({
      success: true,
      cloned_from: base.href,
      page_size_kb: Math.round(html.length / 1024),
      files: ['index.html', 'README.txt'],
      zip_base64: zipBuf,
      download_instructions: 'zip_base64 ko .zip file mein save karo (e.g. Python: open("clone.zip","wb").write(base64.b64decode(data))) ya chat UI se download karo'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
