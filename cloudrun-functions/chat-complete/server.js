const express = require('express');
const app = express();
app.use(express.json({ limit: '4mb' }));

function requireAuth(req, res, next) {
  const expected = process.env.SERVICE_TOKEN;
  if (!expected) return next();
  const got = req.header('x-service-token');
  if (got && got === expected) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

function oaHeaders() {
  return { 'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || ''), 'Content-Type': 'application/json' };
}

app.post('/', requireAuth, async (req, res) => {
  try {
    const { model = 'o3', prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const payload = { model, messages: [{ role: 'user', content: prompt }] };
    const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload) });
    const body = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(body);
    const text = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content || '';
    return res.json({ text, raw: body });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get('/healthz', (req,res)=>res.send('ok'));
const port = process.env.PORT || 8080;
app.listen(port, ()=>console.log('chat-complete service on', port));