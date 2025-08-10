const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));

function requireAuth(req, res, next) {
  const expected = process.env.SERVICE_TOKEN;
  if (!expected) return next();
  const got = req.header('x-service-token');
  if (got && got === expected) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function oaHeadersAssistant() {
  return {
    'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || ''),
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'assistants=v2'
  };
}

async function waitRun(threadId, runId, base = 'https://api.openai.com/v1') {
  const headers = oaHeadersAssistant();
  const start = Date.now();
  while (true) {
    const resp = await fetch(`${base}/threads/${threadId}/runs/${runId}`, { headers });
    const json = await resp.json();
    if (json.status === 'completed') return;
    if (['requires_action','failed','cancelled','expired'].includes(json.status)) throw new Error('Run failed: ' + json.status);
    if (Date.now() - start > 5 * 60 * 1000) throw new Error('Run timeout');
    await new Promise(r => setTimeout(r, 2000));
  }
}

app.post('/', requireAuth, async (req, res) => {
  try {
    const { assistantId, initMsg, userMsg } = req.body || {};
    if (!assistantId || !initMsg || !userMsg) return res.status(400).json({ error: 'assistantId, initMsg, userMsg are required' });
    const base = 'https://api.openai.com/v1';

    const tResp = await fetch(`${base}/threads`, { method: 'POST', headers: oaHeadersAssistant(), body: '{}' });
    const tJson = await tResp.json();
    if (!tResp.ok) return res.status(tResp.status).json(tJson);
    const threadId = tJson.id;

    const m1 = await fetch(`${base}/threads/${threadId}/messages`, { method: 'POST', headers: oaHeadersAssistant(), body: JSON.stringify({ role: 'user', content: initMsg }) });
    if (!m1.ok) return res.status(m1.status).json(await m1.json());

    const r1 = await fetch(`${base}/threads/${threadId}/runs`, { method: 'POST', headers: oaHeadersAssistant(), body: JSON.stringify({ assistant_id: assistantId }) });
    const r1Json = await r1.json();
    if (!r1.ok) return res.status(r1.status).json(r1Json);
    await waitRun(threadId, r1Json.id, base);

    const m2 = await fetch(`${base}/threads/${threadId}/messages`, { method: 'POST', headers: oaHeadersAssistant(), body: JSON.stringify({ role: 'user', content: userMsg }) });
    if (!m2.ok) return res.status(m2.status).json(await m2.json());

    const r2 = await fetch(`${base}/threads/${threadId}/runs`, { method: 'POST', headers: oaHeadersAssistant(), body: JSON.stringify({ assistant_id: assistantId }) });
    const r2Json = await r2.json();
    if (!r2.ok) return res.status(r2.status).json(r2Json);
    await waitRun(threadId, r2Json.id, base);

    const msgsResp = await fetch(`${base}/threads/${threadId}/messages?limit=10`, { headers: oaHeadersAssistant() });
    const msgsJson = await msgsResp.json();
    if (!msgsResp.ok) return res.status(msgsResp.status).json(msgsJson);
    const assistantMsg = (msgsJson.data || []).find(m => m.role === 'assistant');
    const text = assistantMsg && assistantMsg.content && assistantMsg.content[0] && assistantMsg.content[0].text && assistantMsg.content[0].text.value || '';
    return res.json({ threadId, text });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get('/healthz', (req,res)=>res.send('ok'));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log('master-prompts service on', port));