import express from 'express';

const DEFAULT_BASE_URL = 'https://ai.hackclub.com/proxy/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-latest';

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return DEFAULT_BASE_URL;
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are supported.');
  }

  return parsed.toString().replace(/\/+$/, '');
}

async function tryWebSearch(fetchImpl, baseUrl, apiKey, messages) {
  const latestUser = [...messages].reverse().find((msg) => msg?.role === 'user');
  const latestText = typeof latestUser?.content === 'string'
    ? latestUser.content
    : Array.isArray(latestUser?.content)
      ? latestUser.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
      : '';

  if (!latestText?.trim()) {
    return null;
  }

  const response = await fetchImpl(`${baseUrl}/exa/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ query: latestText, numResults: 5 }),
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  const results = body?.results ?? body?.web?.results ?? [];
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  return [
    'Live web search context (cite these URLs when relevant):',
    ...results.slice(0, 5).map((item, index) => `${index + 1}. ${item?.title || 'Untitled'}\nURL: ${item?.url || 'N/A'}\nSummary: ${item?.text || item?.description || 'No summary provided'}`),
  ].join('\n\n');
}

function createApp({ fetchImpl = fetch } = {}) {
  const app = express();

  app.use(express.json({ limit: '25mb' }));
  app.use(express.static('public'));

  app.get('/api/models', async (req, res) => {
    try {
      const baseUrl = normalizeBaseUrl(req.query.baseUrl);
      const response = await fetchImpl(`${baseUrl}/models`);

      if (!response.ok) {
        const text = await response.text();
        return res.status(response.status).json({ error: text || 'Failed to load models.' });
      }

      const data = await response.json();
      return res.json({
        defaultModel: DEFAULT_MODEL,
        models: Array.isArray(data?.data) ? data.data : [],
      });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Invalid base URL.' });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    try {
      const {
        baseUrl: baseUrlInput,
        apiKey,
        model = DEFAULT_MODEL,
        messages = [],
        temperature,
        max_tokens,
        top_p,
        enableWebSearch,
      } = req.body || {};

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages must be a non-empty array.' });
      }

      const baseUrl = normalizeBaseUrl(baseUrlInput);
      const outgoingMessages = [...messages];

      if (enableWebSearch) {
        const webContext = await tryWebSearch(fetchImpl, baseUrl, apiKey, outgoingMessages);
        if (webContext) {
          outgoingMessages.unshift({ role: 'system', content: webContext });
        }
      }

      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: outgoingMessages,
          stream: true,
          ...(typeof temperature === 'number' ? { temperature } : {}),
          ...(typeof max_tokens === 'number' ? { max_tokens } : {}),
          ...(typeof top_p === 'number' ? { top_p } : {}),
        }),
      });

      if (!response.ok || !response.body) {
        const text = await response.text();
        return res.status(response.status || 500).json({ error: text || 'Failed to stream response.' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      for await (const chunk of response.body) {
        res.write(chunk);
      }

      res.end();
      return undefined;
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Unexpected server error.' });
    }
  });

  return app;
}

export { createApp, normalizeBaseUrl, DEFAULT_MODEL, DEFAULT_BASE_URL };
