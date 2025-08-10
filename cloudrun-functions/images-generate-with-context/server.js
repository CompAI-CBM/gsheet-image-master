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

function oaHeaders() { return { 'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || ''), 'Content-Type': 'application/json' }; }

app.post('/', requireAuth, async (req, res) => {
  try {
    const { inputArr = [], userPrompt, imgUrl, model = 'gpt-4.1-mini' } = req.body || {};
    if (!userPrompt) return res.status(400).json({ error: 'userPrompt is required' });

    const userContent = [{ type: 'input_text', text: userPrompt }];
    if (imgUrl) userContent.push({ type: 'input_image', image_url: imgUrl });
    const userMsg = { role: 'user', content: userContent };

    const payload = { model, input: [...inputArr, userMsg], tools: [{ type: 'image_generation' }] };
    const resp = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload) });
    const raw = await resp.text();
    if (!resp.ok) return res.status(resp.status).send(raw);
    const j = JSON.parse(raw);
    const tc = (j.output || []).find(o => o.type === 'image_generation_call');
    if (!tc) {
      const assistant = (j.output || []).find(o => o.type === 'message');
      const txt = assistant && assistant.content && assistant.content.length ? (assistant.content[0].text || '').trim() : '';
      return res.json({ imageB64: '', toolCallObj: null, assistantText: txt });
    }
    return res.json({ imageB64: tc.result, toolCallObj: { type: tc.type, id: tc.id } });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get('/healthz', (req,res)=>res.send('ok'));
const port = process.env.PORT || 8080;
app.listen(port, ()=>console.log('images-generate-with-context service on', port));