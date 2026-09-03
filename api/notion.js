// ============================================
// NOTION - /api/notion
// POST { "title": "Lead: Thompson Construction", "notes": "..." }
// Notion database mein nayi entry banata hai
// Requires:
//   1. https://www.notion.so/my-integrations > New integration > copy token
//   2. Notion mein database banao > ... menu > Connections > apna integration add karo
//   3. NOTION_TOKEN + NOTION_DATABASE_ID (URL se — 32-char string)
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { title, notes, status } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
      return res.status(500).json({
        error: 'Notion not configured',
        setup_help: 'notion.so/my-integrations > token lo, database banao, integration ko database se connect karo, NOTION_TOKEN + NOTION_DATABASE_ID set karo.'
      });
    }

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.NOTION_TOKEN,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          Name: { title: [{ text: { content: title } }] },
          ...(notes ? { Notes: { rich_text: [{ text: { content: String(notes).slice(0, 2000) } }] } } : {}),
          ...(status ? { Status: { rich_text: [{ text: { content: status } }] } } : {})
        }
      })
    });

    const data = await notionRes.json();
    if (!notionRes.ok) throw new Error(data.message || 'Notion error');

    res.json({ success: true, page_url: data.url, page_id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
