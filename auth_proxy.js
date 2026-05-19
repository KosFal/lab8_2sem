function mockFetch(url, { method = 'GET', headers = {} } = {}) {
  const key   = headers['X-API-Key'];
  const token = (headers['Authorization'] || '').replace('Bearer ', '');

  if (key) {
    return key === 'valid-key' ? ok(url, method) : fail(403, 'Bad key');
  }

  if (token === 'expired') return fail(401, 'Expired');
  if (token.startsWith('fresh') || token === 'oauth-token-abc') return ok(url, method);
  if (token) return fail(403, 'Bad token');

  return fail(403, 'No credentials');
}

const ok   = (url, m) => ({ status: 200, body: { ok: true, url, method: m } });
const fail = (s, msg) => ({ status: s,   body: { error: msg } });

class BaseClient {
  constructor(fetch) { this._fetch = fetch; }
  request({ url, method = 'GET', headers = {} }) {
    return this._fetch(url, { method, headers });
  }
}

const withLogging = client => ({
  async request(req) {
    console.log(`→ ${req.method ?? 'GET'} ${req.url}`);
    const res = await client.request(req);
    console.log(`← ${res.status}`);
    return res;
  },
});

const withRateLimit = (client, max) => {
  let count = 0;
  return {
    request(req) {
      if (count >= max) return fail(429, `Ліміт ${max} запитів вичерпано`);
      console.log(`[rate] ${++count}/${max}`);
      return client.request(req);
    },
  };
};
