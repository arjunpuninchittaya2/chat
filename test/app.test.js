import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import request from 'supertest';
import { createApp, DEFAULT_MODEL, normalizeBaseUrl } from '../app.js';

test('normalizeBaseUrl trims trailing slash and supports default', () => {
  assert.equal(normalizeBaseUrl('https://ai.hackclub.com/proxy/v1/'), 'https://ai.hackclub.com/proxy/v1');
  assert.equal(normalizeBaseUrl(), 'https://ai.hackclub.com/proxy/v1');
});

test('DEFAULT_MODEL is the expected exact text', () => {
  assert.equal(DEFAULT_MODEL, '~anthropic/claude-sonnet-latest');
});

test('GET /api/models returns model list and default model', async () => {
  const app = createApp({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { data: [{ id: 'qwen/qwen3-32b' }] };
      },
    }),
  });

  const response = await request(app).get('/api/models');
  assert.equal(response.status, 200);
  assert.equal(response.body.defaultModel, DEFAULT_MODEL);
  assert.deepEqual(response.body.models, [{ id: 'qwen/qwen3-32b' }]);
});

test('POST /api/chat/stream validates empty messages', async () => {
  const app = createApp();
  const response = await request(app).post('/api/chat/stream').send({ messages: [] });
  assert.equal(response.status, 400);
});

test('POST /api/chat/stream injects Hack Club web search context when enabled', async () => {
  let outgoingChatBody;

  const app = createApp({
    fetchImpl: async (url, options = {}) => {
      if (url.startsWith('https://search.hackclub.com/res/v1/web/search?')) {
        assert.equal(options.headers.Authorization, 'Bearer sk-hc-v1-test');
        return {
          ok: true,
          async json() {
            return {
              web: {
                results: [
                  {
                    title: 'Hack Club',
                    url: 'https://hackclub.com',
                    description: 'Hack Club official website',
                  },
                ],
              },
            };
          },
        };
      }

      if (url.endsWith('/chat/completions')) {
        outgoingChatBody = JSON.parse(options.body);
        return {
          ok: true,
          body: Readable.from([]),
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const response = await request(app)
    .post('/api/chat/stream')
    .send({
      apiKey: 'sk-ai-v1-test',
      searchApiKey: 'sk-hc-v1-test',
      enableWebSearch: true,
      messages: [{ role: 'user', content: 'latest hack club news' }],
    });

  assert.equal(response.status, 200);
  assert.equal(outgoingChatBody.messages[0].role, 'system');
  assert.match(outgoingChatBody.messages[0].content, /https:\/\/hackclub\.com/);
  assert.equal(outgoingChatBody.messages[1].role, 'user');
});
