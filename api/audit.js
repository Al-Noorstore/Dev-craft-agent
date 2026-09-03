// ============================================
// WEBSITE AUDITOR - /api/audit
// POST { "url": "https://example.com" }
// Kisi bhi website ko audit karta hai: HTTPS, speed,
// title/meta, mobile-friendliness, page size, tech detection
// NO API key needed - ye free chalta hai!
// ============================================
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

    const issues = [];
    const start = Date.now();
    const fetchRes = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const loadMs = Date.now() - start;
    const html = await fetchRes.text();

    const finalUrl = fetchRes.url;
    const hasHttps = finalUrl.startsWith('https://');
    if (!hasHttps) issues.push({ severity: 'CRITICAL', issue: 'No HTTPS - browsers show "Not Secure" warning to visitors' });

    // Redirect check
    if (fetchRes.redirected && !finalUrl.replace(/\/$/, '') === url.replace(/\/$/, '')) {
      issues.push({ severity: 'low', issue: 'Redirects to another URL' });
    }

    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    if (!title) issues.push({ severity: 'high', issue: 'Missing page title (bad for Google ranking)' });
    else if (title.length > 65) issues.push({ severity: 'low', issue: 'Title too long for Google results' });

    // Meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    if (!descMatch) issues.push({ severity: 'high', issue: 'Missing meta description (bad for Google ranking)' });

    // Mobile viewport
    const viewport = /<meta[^>]*name=["']viewport["']/i.test(html);
    if (!viewport) issues.push({ severity: 'CRITICAL', issue: 'No mobile viewport - site breaks on phones (not mobile-friendly)' });

    // Page size
    const sizeKB = Math.round(Buffer.byteLength(html, 'utf8') / 1024);
    if (sizeKB > 300) issues.push({ severity: 'medium', issue: `Heavy page (${sizeKB} KB HTML) - slow loading` });

    // Load speed
    if (loadMs > 3000) issues.push({ severity: 'high', issue: `Slow server response (${loadMs} ms)` });
    else if (loadMs > 1500) issues.push({ severity: 'medium', issue: `Sluggish server response (${loadMs} ms)` });

    // Tech detection
    const tech = [];
    if (/wp-content|wp-includes/i.test(html)) tech.push('WordPress');
    if (/shopify/i.test(html)) tech.push('Shopify');
    if (/wix\.com|wixstatic/i.test(html)) tech.push('Wix');
    if (/squarespace/i.test(html)) tech.push('Squarespace');
    if (/react|__NEXT_DATA__/i.test(html)) tech.push('React/Next.js');
    if (/jquery/i.test(html)) tech.push('jQuery (older stack)');
    if (/bootstrap/i.test(html)) tech.push('Bootstrap');
    if (/flash|marquee|<font/i.test(html)) {
      issues.push({ severity: 'high', issue: 'Very outdated HTML detected (flash/marquee/font tags - 2000s era code)' });
      tech.push('Legacy HTML');
    }

    // Images missing alt
    const imgs = (html.match(/<img[^>]*>/gi) || []);
    const noAlt = imgs.filter(t => !/alt=["'][^"']+["']/i.test(t)).length;
    if (noAlt > 3) issues.push({ severity: 'medium', issue: `${noAlt} images missing alt text (bad for SEO + accessibility)` });

    // Contact info detection
    const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(html);
    const hasPhone = /tel:|\(\d{3}\)\s?\d{3}/.test(html);

    // Score calculation (start 100, minus per severity)
    const sevWeight = { CRITICAL: 25, high: 12, medium: 6, low: 2 };
    let score = 100;
    for (const i of issues) score -= sevWeight[i.severity] || 2;
    score = Math.max(0, score);

    res.json({
      url: finalUrl,
      audit_score: score,
      load_time_ms: loadMs,
      page_size_kb: sizeKB,
      https: hasHttps,
      mobile_friendly: viewport,
      title,
      has_meta_description: !!descMatch,
      detected_tech: tech,
      has_contact_email: hasEmail,
      has_phone: hasPhone,
      issues,
      verdict: score >= 80 ? 'Good website - hard to sell redesign'
        : score >= 55 ? 'Average - some improvement possible'
        : score >= 35 ? 'Needs modernization - good prospect!'
        : 'Very outdated - BEST prospect for redesign!'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
