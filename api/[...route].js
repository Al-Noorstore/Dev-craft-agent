// ============================================
// SINGLE CATCH-ALL ROUTER - /api/[...route]
// Free (Hobby) plan allows max 12 serverless functions,
// so all 24 endpoints live in this ONE function.
// URLs stay exactly the same: /api/chat, /api/search, etc.
// ============================================
const routes = {
  'audit': require('../server/endpoints/audit.js'),
  'automations': require('../server/endpoints/automations.js'),
  'bridge': require('../server/endpoints/bridge.js'),
  'chat': require('../server/endpoints/chat.js'),
  'credentials': require('../server/endpoints/credentials.js'),
  'clone-site': require('../server/endpoints/clone-site.js'),
  'deploy-vercel': require('../server/endpoints/deploy-vercel.js'),
  'discord': require('../server/endpoints/discord.js'),
  'draft-email': require('../server/endpoints/draft-email.js'),
  'drive': require('../server/endpoints/drive.js'),
  'exec': require('../server/endpoints/exec.js'),
  'files': require('../server/endpoints/files.js'),
  'generate-image': require('../server/endpoints/generate-image.js'),
  'github': require('../server/endpoints/github.js'),
  'gitlab': require('../server/endpoints/gitlab.js'),
  'leads': require('../server/endpoints/leads.js'),
  'notion': require('../server/endpoints/notion.js'),
  'read-emails': require('../server/endpoints/read-emails.js'),
  'report': require('../server/endpoints/report.js'),
  'run-automations': require('../server/endpoints/run-automations.js'),
  'score': require('../server/endpoints/score.js'),
  'search': require('../server/endpoints/search.js'),
  'send-email': require('../server/endpoints/send-email.js'),
  'sheets': require('../server/endpoints/sheets.js'),
  'slack': require('../server/endpoints/slack.js'),
  'stripe-payment': require('../server/endpoints/stripe-payment.js'),
  'telegram': require('../server/endpoints/telegram.js'),
  'twitter': require('../server/endpoints/twitter.js'),
  'whatsapp': require('../server/endpoints/whatsapp.js'),
};

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  let route = url.pathname.replace(/^\/api\/+/, '').replace(/\/+$/, '');

  const handler = routes[route];
  if (!handler) {
    return res.status(404).json({
      error: 'Unknown endpoint: /api/' + route,
      available: Object.keys(routes).map(function(r) { return '/api/' + r; }),
    });
  }
  return handler(req, res);
};
