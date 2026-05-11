import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp, DEFAULT_MODEL, normalizeBaseUrl } from '../app.js';

test('normalizeBaseUrl trims trailing slash and supports default', () => {
  assert.equal(normalizeBaseUrl('https://ai.hackclub.com/proxy/v1/'), 'https://ai.hackclub.com/proxy/v1');
  assert.equal(normalizeBaseUrl(), 'https://ai.hackclub.com/proxy/v1');
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
