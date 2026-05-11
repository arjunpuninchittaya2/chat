import express from 'express';

const DEFAULT_BASE_URL = 'https://ai.hackclub.com/proxy/v1';
const DEFAULT_MODEL = '~anthropic/claude-sonnet-latest';
const HACK_CLUB_SEARCH_BASE_URL = 'https://search.hackclub.com';
const ALLOWED_BASE_HOSTS = new Set(['ai.hackclub.com', 'openrouter.ai', 'localhost', '127.0.0.1']);

function trimTrailingSlashes(value) {
  let output = value;
  while (output.endsWith('/')) {
    output = output.slice(0, -1);
  }
  return output;
}

function isAllowedBaseUrl(parsed) {
  if (parsed.protocol === 'https:') {
    return ALLOWED_BASE_HOSTS.has(parsed.hostname);
  }

  return parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return DEFAULT_BASE_URL;
  }

  const trimmed = trimTrailingSlashes(baseUrl.trim());
  const parsed = new URL(trimmed);
  if (!isAllowedBaseUrl(parsed)) {
    throw new Error('Only Hack Club AI or OpenRouter base URLs are allowed.');
  }

  return trimTrailingSlashes(parsed.toString());
}

function getLatestUserText(messages) {
  const latestUser = [...messages].reverse().find((msg) => msg?.role === 'user');
  return typeof latestUser?.content === 'string'
    ? latestUser.content
    : Array.isArray(latestUser?.content)
      ? latestUser.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
      : '';
}

async function tryWebSearch(fetchImpl, apiKey, messages) {
  const latestText = getLatestUserText(messages);

  if (!latestText?.trim() || !apiKey) {
    return null;
  }

  const params = new URLSearchParams({ q: latestText.trim(), count: '5' });
  const response = await fetchImpl(`${HACK_CLUB_SEARCH_BASE_URL}/res/v1/web/search?${params}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  const results = body?.web?.results ?? body?.results ?? [];
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  return [
    'Live web search context from Hack Club Search (cite these URLs when relevant):',
    ...results.slice(0, 5).map((item, index) => `${index + 1}. ${item?.title || 'Untitled'}\nURL: ${item?.url || 'N/A'}\nSummary: ${item?.description || item?.text || 'No summary provided'}`),
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
        searchApiKey,
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
        const webContext = await tryWebSearch(fetchImpl, searchApiKey || apiKey, outgoingMessages);
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
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Unexpected server error.' });
    }
  });

  return app;
}

export { createApp, normalizeBaseUrl, DEFAULT_MODEL, DEFAULT_BASE_URL };
