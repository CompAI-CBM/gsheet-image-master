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

function oaHeaders() { return { 'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || ''), 'Content-Type': 'application/json' }; }

app.post('/', requireAuth, async (req, res) => {
  try {
    const { guidelinePrompt, packLink, model = 'gpt-4o-mini' } = req.body || {};
    if (!guidelinePrompt || !packLink) return res.status(400).json({ error: 'guidelinePrompt and packLink are required' });

    const payload = { model, input: [{ role: 'user', content: [ { type: 'input_text', text: guidelinePrompt }, { type: 'input_image', image_url: packLink } ] }] };
    const resp = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload) });
    const j = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(j);

    const msg = (j.output && j.output[0]) || null;
    const txt = msg && (msg.text || (msg.content && msg.content.length && msg.content[0].text)) || '';
    if (!txt) return res.status(502).json({ error: 'Empty guideline reply', raw: j });
    return res.json({ text: String(txt).trim(), assistantMsg: msg });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get('/healthz', (req,res)=>res.send('ok'));
const port = process.env.PORT || 8080;
app.listen(port, ()=>console.log('vision-guidelines service on', port));