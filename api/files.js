// ============================================
// FILE TOOLS - /api/files
// Ek endpoint, 5 kaam (user uploads ko process karta hai):
// POST { "action": "unzip", "zip_base64": "..." }        => zip kholo: files list + text files ka content
// POST { "action": "csv_parse", "csv": "a,b,c\n1,2,3" }  => CSV => JSON
// POST { "action": "csv_create", "json": [{...},{...}] } => JSON => CSV
// POST { "action": "pdf_read", "pdf_base64": "..." }     => PDF => text
// POST { "action": "image_read", "image_url" | "image_base64", "question" }
//                                                          => AI image ki parhai (OCR + description)
// FREE (image_read ke liye OpenAI key chahiye)
// ============================================
const JSZip = require('jszip');
const OpenAI = require('openai');

// ---------- CSV parser (dependency-free) ----------
function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; }
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {};
    header.forEach((h, i) => obj[h] = (r[i] || '').trim());
    return obj;
  });
}

function toCSV(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  const header = Object.keys(arr[0]);
  const esc = v => { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [header.join(','), ...arr.map(o => header.map(h => esc(o[h])).join(','))].join('\n');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { action } = req.body || {};

    // ---------- UNZIP ----------
    if (action === 'unzip') {
      const { zip_base64 } = req.body;
      if (!zip_base64) return res.status(400).json({ error: 'zip_base64 required (file ko base64 mein convert karo)' });
      const zip = await JSZip.loadAsync(Buffer.from(zip_base64, 'base64'));
      const files = [];
      for (const name of Object.keys(zip.files)) {
        const f = zip.files[name];
        if (f.dir) continue;
        const size = (await f.async('nodebuffer')).length;
        const isText = /\.(txt|md|json|js|css|html|csv|xml|yml|yaml|py|env|gitignore|svg)$/i.test(name);
        let content = null;
        if (isText && size < 1024 * 1024) {
          const text = await f.async('string');
          content = text.length > 5000 ? text.slice(0, 5000) + '\n...[truncated]' : text;
        }
        files.push({ name, size_bytes: size, type: isText ? 'text' : 'binary', content });
      }
      return res.json({ success: true, file_count: files.length, files });
    }

    // ---------- CSV PARSE ----------
    if (action === 'csv_parse') {
      const { csv } = req.body;
      if (!csv) return res.status(400).json({ error: 'csv required (CSV ka text paste karo)' });
      const rows = parseCSV(String(csv));
      return res.json({ success: true, row_count: rows.length, columns: rows.length ? Object.keys(rows[0]) : [], data: rows.slice(0, 100) });
    }

    // ---------- CSV CREATE ----------
    if (action === 'csv_create') {
      const { json } = req.body;
      if (!Array.isArray(json) || !json.length) return res.status(400).json({ error: 'json required (array of objects)' });
      return res.json({ success: true, csv: toCSV(json) });
    }

    // ---------- PDF READ ----------
    if (action === 'pdf_read') {
      const { pdf_base64 } = req.body;
      if (!pdf_base64) return res.status(400).json({ error: 'pdf_base64 required' });
      try {
        const pdfParse = require('pdf-parse/lib/pdf-parse.js');
        const result = await pdfParse(Buffer.from(pdf_base64, 'base64'));
        return res.json({
          success: true, pages: result.numpages,
          text: (result.text || '').slice(0, 10000)
        });
      } catch (e) {
        return res.status(500).json({ error: 'PDF read failed: ' + e.message + ' — scanned images wale PDF ka text nahi nikalta, wo image_read se OCR karo' });
      }
    }

    // ---------- IMAGE READ (AI eyes!) ----------
    if (action === 'image_read') {
      const { image_url, image_base64, question } = req.body;
      if (!image_url && !image_base64) return res.status(400).json({ error: 'image_url ya image_base64 required' });
      if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY env var missing' });

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const imageUrl = image_base64
        ? 'data:image/png;base64,' + image_base64.replace(/^data:image\/\w+;base64,/, '')
        : image_url;

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        max_tokens: 500,
        messages: [
          { role: 'user', content: [
            { type: 'text', text: question || 'Is image mein kya likha hai? Pura text aur important details batao.' },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]}
        ]
      });
      return res.json({ success: true, analysis: completion.choices[0].message.content });
    }

    res.status(400).json({ error: 'action required: unzip | csv_parse | csv_create | pdf_read | image_read' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
