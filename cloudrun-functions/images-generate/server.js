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

function oaHeaders() {
  return { 'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || ''), 'Content-Type': 'application/json' };
}

app.post('/', requireAuth, async (req, res) => {
  try {
    const { system, user, prodImgUrl } = req.body || {};
    if (!user) return res.status(400).json({ error: 'user is required' });
    const inputArr = [];
    if (system) inputArr.push({ role: 'system', content: system });
    const userContent = [{ type: 'input_text', text: user }];
    if (prodImgUrl) userContent.push({ type: 'input_image', image_url: prodImgUrl });
    inputArr.push({ role: 'user', content: userContent });
    const payload = { model: 'gpt-4o', input: inputArr, tools: [{ type: 'image_generation' }] };
    const resp = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload) });
    const raw = await resp.text();
    if (!resp.ok) return res.status(resp.status).send(raw);
    try {
      const j = JSON.parse(raw);
      const tc = (j.output || []).find(o => o.type === 'image_generation_call');
      const b64 = tc && tc.result ? tc.result : '';
      return res.json({ b64, raw: j });
    } catch (_) {
      return res.json({ b64: '', raw });
    }
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get('/healthz', (req,res)=>res.send('ok'));
const port = process.env.PORT || 8080;
app.listen(port, ()=>console.log('images-generate service on', port));