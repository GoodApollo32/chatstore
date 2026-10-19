import { describe, expect, it } from 'vitest';
import type { IngramConfig } from '../src/config.js';
import { assertAllowed, EndpointNotAllowedError, IngramApiError, IngramClient, type ApiCallRecord } from '../src/ingram/client.js';

const config: IngramConfig = {
  clientId: 'id', clientSecret: 'secret', customerNumber: '20-123456', countryCode: 'CA', env: 'sandbox', senderId: undefined,
  baseUrl: 'https://api.example.test/sandbox', authBaseUrl: 'https://api.example.test', maxRequestsPerSecond: 1000,
};

type Handler = (url: URL, init: RequestInit) => Response;

function fakeFetch(handler: Handler) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: any, init: any) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, requests };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const token = () => json(200, { access_token: 'tok', token_type: 'Bearer', expires_in: '86399' });

function client(handler: Handler) {
  const f = fakeFetch(handler);
  const calls: ApiCallRecord[] = [];
  const sleeps: number[] = [];
  const c = new IngramClient(config, { fetch: f.fn, onCall: (r) => calls.push(r), sleep: async (ms) => void sleeps.push(ms) });
  return { c, requests: f.requests, calls, sleeps };
}

describe('safety rail: endpoint allowlist', () => {
  it.each([
    ['POST', '/resellers/v6/orders'],
    ['POST', '/resellers/v7/orders'],
    ['PUT', '/resellers/v6/orders/20-RD3QV'],
    ['DELETE', '/resellers/v6/orders/20-RD3QV'],
    ['POST', '/resellers/v6/quotes'],
    ['POST', '/resellers/v6/returns/create'],
    ['GET', '/resellers/v6/catalog/../orders'],
  ])('refuses %s %s', (method, path) => {
    expect(() => assertAllowed(method, path)).toThrow(EndpointNotAllowedError);
  });

  it('allows the catalog and price & availability calls', () => {
    expect(() => assertAllowed('GET', '/resellers/v6/catalog')).not.toThrow();
    expect(() => assertAllowed('POST', '/resellers/v6/catalog/priceandavailability')).not.toThrow();
    expect(() => assertAllowed('GET', '/resellers/v6/catalog/details/5348387')).not.toThrow();
  });

  it('refuses before any request is sent', async () => {
    const { c, requests } = client(() => token());
    await expect(c.post('/resellers/v6/orders', {}, {})).rejects.toThrow(EndpointNotAllowedError);
    expect(requests).toHaveLength(0);
  });
});

describe('requests', () => {
  it('signs in with oauth30 and sends the required Ingram headers', async () => {
    const { c, requests } = client((url) => (url.pathname.includes('oauth') ? token() : json(200, { catalog: [] })));
    await c.get('/resellers/v6/catalog', { vendor: 'Lenovo', pageNumber: 1 });
    expect(requests[0]!.url.pathname).toBe('/oauth/oauth30/token');
    expect(requests[0]!.init.method).toBe('POST');
    const api = requests[1]!;
    expect(api.url.toString()).toBe('https://api.example.test/sandbox/resellers/v6/catalog?vendor=Lenovo&pageNumber=1');
    const h = api.init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['IM-CustomerNumber']).toBe('20-123456');
    expect(h['IM-CountryCode']).toBe('CA');
    expect(h['IM-CorrelationID']).toMatch(/^[0-9a-f]{32}$/); // Ingram allows at most 32 characters
  });

  it('uses a different correlation ID on every request and logs each one', async () => {
    const { c, calls } = client((url) => (url.pathname.includes('oauth') ? token() : json(200, {})));
    await c.get('/resellers/v6/catalog');
    await c.get('/resellers/v6/catalog');
    const ids = calls.map((x) => x.correlationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the oauth20 token endpoint when oauth30 is refused', async () => {
    const { c, requests } = client((url) => {
      if (url.pathname === '/oauth/oauth30/token') return json(404, { message: 'not found' });
      if (url.pathname === '/oauth/oauth20/token') return token();
      return json(200, {});
    });
    await c.get('/resellers/v6/catalog');
    await c.get('/resellers/v6/catalog');
    expect(requests.map((r) => r.url.pathname)).toEqual([
      '/oauth/oauth30/token', '/oauth/oauth20/token', '/sandbox/resellers/v6/catalog', '/sandbox/resellers/v6/catalog',
    ]);
  });

  it('backs off and retries on 429 and 5xx, honouring Retry-After', async () => {
    let n = 0;
    const { c, sleeps } = client((url) => {
      if (url.pathname.includes('oauth')) return token();
      n++;
      if (n === 1) return json(429, { message: 'slow down' }, { 'retry-after': '3' });
      if (n === 2) return json(503, { message: 'busy' });
      return json(200, { ok: true });
    });
    const res = await c.get('/resellers/v6/catalog');
    expect(res.body).toEqual({ ok: true });
    const backoffs = sleeps.filter((ms) => ms >= 1000); // ignore the rate limiter's tiny gaps
    expect(backoffs).toContain(3000);
    expect(backoffs).toHaveLength(2);
  });

  it('gives up after the maximum attempts with the correlation ID in the error', async () => {
    const { c } = client((url) => (url.pathname.includes('oauth') ? token() : json(500, { fault: { faultstring: 'boom' } })));
    const err = await c.get('/resellers/v6/catalog').catch((e) => e);
    expect(err).toBeInstanceOf(IngramApiError);
    expect(err.status).toBe(500);
    expect(err.correlationId).toMatch(/^[0-9a-f]{32}$/);
    expect(err.message).toContain('boom');
  });

  it('does not retry a 400 and reports Ingram\'s validation message', async () => {
    const { c, requests } = client((url) =>
      url.pathname.includes('oauth') ? token()
        : json(400, { errors: [{ message: 'Validation failed', fields: [{ field: 'IM-CountryCode', message: 'invalid' }] }] }));
    const err = await c.get('/resellers/v6/catalog').catch((e) => e);
    expect(err.message).toContain('IM-CountryCode: invalid');
    expect(requests.filter((r) => !r.url.pathname.includes('oauth'))).toHaveLength(1);
  });

  it('gets a fresh token once after a 401', async () => {
    let tokens = 0;
    let api = 0;
    const { c } = client((url) => {
      if (url.pathname.includes('oauth')) return (tokens++, token());
      return ++api === 1 ? json(401, { message: 'expired' }) : json(200, {});
    });
    await c.get('/resellers/v6/catalog');
    expect(tokens).toBe(2);
  });
});
