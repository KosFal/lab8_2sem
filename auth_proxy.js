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

const strategies = {
  apiKey: key => ({
    name: 'ApiKey',
    headers: () => ({ 'X-API-Key': key }),
  }),
  jwt: (initialToken, refreshFn) => {
    let token = initialToken;
    return {
      name: 'JWT',
      headers: () => ({ Authorization: `Bearer ${token}` }),
      refresh: async () => { token = await refreshFn(); console.log('[jwt] новий токен:', token); },
    };
  },
  oauth: (clientId, clientSecret) => {
    let cached = null;
    return {
      name: 'OAuth',
      headers: async () => {
        if (!cached) cached = await mockOauthFetch(clientId, clientSecret);
        return { Authorization: `Bearer ${cached}` };
      },
    };
  },
};

async function mockOauthFetch(id, secret) {
  return id === 'id' && secret === 'secret' ? 'oauth-token-abc' : null;
}

const withAuth = (client, strategy) => {
  let current = strategy;
  return {
    setStrategy(s) { console.log(`[auth] ${current.name} → ${s.name}`); current = s; },
    async request(req) {
      const authed = { ...req, headers: { ...req.headers, ...(await current.headers()) } };
      let res = await client.request(authed);
      if (res.status === 401 && current.refresh) {
        console.log('[auth] 401 → refresh...');
        await current.refresh();
        res = await client.request({ ...req, headers: { ...req.headers, ...(await current.headers()) } });
      }
      return res;
    },
  };
};

class ApiService {
  constructor(client) { this._client = client; }
  get(url)        { return this._client.request({ url, method: 'GET' }); }
  post(url, body) { return this._client.request({ url, method: 'POST', body }); }
}

(async () => {
  const jwtExpired = strategies.jwt('expired', () => 'fresh-' + Date.now());
  const apiKey     = strategies.apiKey(process.env.API_KEY || 'valid-key');
  const oauth      = strategies.oauth('id', 'secret');
  const proxy      = withAuth(withRateLimit(withLogging(new BaseClient(mockFetch)), 5), jwtExpired);
  const svc        = new ApiService(proxy);

  console.log('\n── JWT 401 → auto refresh ──');
  console.log(await svc.get('/api/me'));

  console.log('\n── switch → ApiKey ──');
  proxy.setStrategy(apiKey);
  console.log(await svc.post('/api/items', { x: 1 }));

  console.log('\n── switch → OAuth ──');
  proxy.setStrategy(oauth);
  console.log(await svc.get('/api/data'));

  console.log('\n── 429 rate limit ──');
  console.log(await svc.get('/api/data'));
  console.log(await svc.get('/api/data'));
})();
