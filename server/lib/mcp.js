// ============================================
// MCP CLIENT (Streamable HTTP) - server/lib/mcp.js
// Model Context Protocol servers se jodta hai:
// initialize -> tools/list -> tools/call
// (JSON-RPC 2.0 over HTTP POST — MCP SDK ki zaroorat nahi)
//
// Koi bhi public/remote MCP server URL chalega:
//   https://mcp.supabase.com/mcp?project_ref=xxx
//   https://server.smithery.xyz/... waghera
// Auth: optional Bearer token per server.
// ============================================
const PROTO = '2025-03-26';
const CLIENT_INFO = { name: 'dev-craft-agent', version: '1.0.0' };

async function rpc(url, token, body, sessionId) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  // SSE response ho to plain JSON nikaalo
  const ct = (r.headers.get('content-type') || '');
  let data = null, sid = r.headers.get('mcp-session-id');
  const text = await r.text();
  if (ct.includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (line.startsWith('data:')) {
        try { data = JSON.parse(line.slice(5).trim()); } catch (e) {}
      }
    }
  } else {
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  }
  return { ok: r.ok, status: r.status, data, sid, raw: text.slice(0, 400) };
}

// server se handshake karke session id + protocol version lo
async function handshake(url, token) {
  const init = await rpc(url, token, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: PROTO, capabilities: {}, clientInfo: CLIENT_INFO }
  });
  if (!init.ok || !init.data || init.data.error) {
    const msg = (init.data && init.data.error && init.data.error.message) || ('HTTP ' + init.status + (init.raw ? ' - ' + init.raw : ''));
    throw new Error('MCP connect fail: ' + msg);
  }
  // initialized notification (kuch servers zaroori maangte hain)
  await rpc(url, token, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid).catch(() => {});
  return init;
}

// server ke tools ki list ( naam + description + schema )
async function listTools(url, token) {
  const init = await handshake(url, token);
  const r = await rpc(url, token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sid);
  if (!r.ok || !r.data) throw new Error('tools/list fail (HTTP ' + r.status + ')');
  const tools = (r.data.result && r.data.result.tools) || [];
  return tools.map(t => ({
    name: t.name,
    description: (t.description || '').slice(0, 200),
    params: t.inputSchema && t.inputSchema.properties ? Object.keys(t.inputSchema.properties) : []
  }));
}

// tool chalao
async function callTool(url, token, toolName, args) {
  const init = await handshake(url, token);
  const r = await rpc(url, token, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: toolName, arguments: args || {} }
  }, init.sid);
  if (!r.ok || !r.data) throw new Error('tools/call fail (HTTP ' + r.status + ')');
  if (r.data.error) throw new Error(r.data.error.message || 'tool error');
  const content = (r.data.result && r.data.result.content) || [];
  const text = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  return { ok: !(r.data.result && r.data.result.isError), result: text || JSON.stringify(r.data.result).slice(0, 4000) };
}

module.exports = { listTools, callTool };
