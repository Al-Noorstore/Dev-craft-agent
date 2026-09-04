// ============================================
// DAILY REPORT - /api/report
// Roz subah 9 AM PKT (4:00 UTC) automatic chalta hai (Vercel cron)
// Leads database ka summary email pe bhejta hai
// Chalane ke liye chaaro cheezein chahiye: Supabase (leads) + Gmail (send) + optional OpenAI
// ============================================
const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  try {
    const SB_URL = process.env.SUPABASE_URL;
    const SB_KEY = process.env.SUPABASE_ANON_KEY;
    let leadStats = 'Supabase not configured';
    let total = 0, highPriority = 0, newToday = 0;

    if (SB_URL && SB_KEY) {
      const headers = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
      const listRes = await fetch(SB_URL + '/rest/v1/leads?select=*', { headers });
      if (listRes.ok) {
        const leads = await listRes.json();
        total = leads.length;
        highPriority = leads.filter(l => (l.lead_score || 0) >= 75).length;
        const yesterday = new Date(Date.now() - 86400000).toISOString();
        newToday = leads.filter(l => l.created_at && l.created_at > yesterday).length;
        leadStats = `Total: ${total} | High-priority (75+): ${highPriority} | Added in last 24h: ${newToday}`;
      }
    }

    // Build report text
    let report = `📊 DEV CRAFT STUDIO - DAILY REPORT (${new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })})\n\n`;
    report += `Leads: ${leadStats}\n\n`;
    report += `Next steps:\n- High-priority leads ko email bhejo (audit + draft-email endpoints use karo)\n- Sent emails ke replies check karo (read-emails endpoint)\n`;

    // Try email delivery
    let emailStatus = 'Email not configured (EMAIL_USER + EMAIL_APP_PASSWORD missing)';
    if (process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
      });
      await transporter.sendMail({
        from: '"Dev Craft Agent" <' + process.env.EMAIL_USER + '>',
        to: process.env.REPORT_EMAIL || process.env.EMAIL_USER,
        subject: '📊 Daily Agency Report - ' + new Date().toLocaleDateString('en-PK'),
        text: report
      });
      emailStatus = 'Email sent ✅';
    }

    if (res) res.json({ success: true, total_leads: total, high_priority: highPriority, new_last_24h: newToday, email_status: emailStatus, report_preview: report });
    return { success: true };
  } catch (err) {
    if (res) res.status(500).json({ error: err.message });
    console.error('Report error:', err);
  }
};
