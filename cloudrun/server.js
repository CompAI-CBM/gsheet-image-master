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
  return {
    'Authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || ''),
    'Content-Type': 'application/json'
  };
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
    if (['requires_action', 'failed', 'cancelled', 'expired'].includes(json.status)) {
      throw new Error('Run failed: ' + json.status);
    }
    if (Date.now() - start > 5 * 60 * 1000) {
      throw new Error('Run timeout');
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}

app.post('/assistant/master-prompts', requireAuth, async (req, res) => {
  try {
    const { assistantId, initMsg, userMsg } = req.body || {};
    if (!assistantId || !initMsg || !userMsg) {
      return res.status(400).json({ error: 'assistantId, initMsg, userMsg are required' });
    }
    const base = 'https://api.openai.com/v1';

    // 1) create thread
    const tResp = await fetch(`${base}/threads`, { method: 'POST', headers: oaHeadersAssistant(), body: '{}' });
    const tJson = await tResp.json();
    if (!tResp.ok) return res.status(tResp.status).json(tJson);
    const threadId = tJson.id;

    // 2) add init message
    const m1 = await fetch(`${base}/threads/${threadId}/messages`, {
      method: 'POST', headers: oaHeadersAssistant(),
      body: JSON.stringify({ role: 'user', content: initMsg })
    });
    if (!m1.ok) return res.status(m1.status).json(await m1.json());

    // 3) run assistant (init)
    const r1 = await fetch(`${base}/threads/${threadId}/runs`, {
      method: 'POST', headers: oaHeadersAssistant(),
      body: JSON.stringify({ assistant_id: assistantId })
    });
    const r1Json = await r1.json();
    if (!r1.ok) return res.status(r1.status).json(r1Json);
    await waitRun(threadId, r1Json.id, base);

    // 4) add user message
    const m2 = await fetch(`${base}/threads/${threadId}/messages`, {
      method: 'POST', headers: oaHeadersAssistant(),
      body: JSON.stringify({ role: 'user', content: userMsg })
    });
    if (!m2.ok) return res.status(m2.status).json(await m2.json());

    // 5) run assistant (user)
    const r2 = await fetch(`${base}/threads/${threadId}/runs`, {
      method: 'POST', headers: oaHeadersAssistant(),
      body: JSON.stringify({ assistant_id: assistantId })
    });
    const r2Json = await r2.json();
    if (!r2.ok) return res.status(r2.status).json(r2Json);
    await waitRun(threadId, r2Json.id, base);

    // 6) fetch latest assistant message
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

app.post('/chat/complete', requireAuth, async (req, res) => {
  try {
    const { model = 'o3', prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    const payload = { model, messages: [{ role: 'user', content: prompt }] };
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload)
    });
    const body = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(body);
    const text = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content || '';
    return res.json({ text, raw: body });
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.post('/images/generate', requireAuth, async (req, res) => {
  try {
    const { system, user, prodImgUrl } = req.body || {};
    if (!user) return res.status(400).json({ error: 'user is required' });

    const inputArr = [];
    if (system) inputArr.push({ role: 'system', content: system });
    const userContent = [{ type: 'input_text', text: user }];
    if (prodImgUrl) userContent.push({ type: 'input_image', image_url: prodImgUrl });
    inputArr.push({ role: 'user', content: userContent });

    const payload = { model: 'gpt-4o', input: inputArr, tools: [{ type: 'image_generation' }] };
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload)
    });
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

app.post('/images/generate-with-context', requireAuth, async (req, res) => {
  try {
    const { inputArr = [], userPrompt, imgUrl, model = 'gpt-4.1-mini' } = req.body || {};
    if (!userPrompt) return res.status(400).json({ error: 'userPrompt is required' });

    const userContent = [{ type: 'input_text', text: userPrompt }];
    if (imgUrl) userContent.push({ type: 'input_image', image_url: imgUrl });
    const userMsg = { role: 'user', content: userContent };

    const payload = { model, input: [...inputArr, userMsg], tools: [{ type: 'image_generation' }] };
    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: oaHeaders(), body: JSON.stringify(payload)
    });
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

app.post('/vision/guidelines', requireAuth, async (req, res) => {
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

app.get('/healthz', (req, res) => res.send('ok'));

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log('Service listening on port', port);
});