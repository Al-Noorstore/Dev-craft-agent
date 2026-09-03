// ============================================
// EMAIL SEND - /api/send-email
// POST { "to", "subject", "message" }
// Uses Gmail SMTP (requires EMAIL_USER + EMAIL_APP_PASSWORD)
// Gmail App Password: Google Account > Security > 2-Step Verification > App passwords
// ============================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { to, subject, message, from_name } = req.body || {};
    if (!to || !subject || !message) {
      return res.status(400).json({ error: 'to, subject, message required' });
    }
    if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
      return res.status(500).json({ error: 'EMAIL_USER and EMAIL_APP_PASSWORD env vars missing (set in Vercel)' });
    }

    // Send via Gmail SMTP using raw fetch (nodemailer-free approach)
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: `"${from_name || 'Dev Craft Studio'}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text: message
    });

    res.json({ success: true, sent_to: to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
