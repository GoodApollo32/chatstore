import { randomUUID } from 'node:crypto';
import type { IngramConfig } from '../config.js';

// Low-level Ingram Micro reseller API client: authentication, the endpoint allowlist, rate limiting,
// retries and per-call logging. It knows nothing about our data model; see connector.ts for that.

/**
 * The only calls this system may make. Anything else, in particular order, quote and return
 * endpoints, is refused before a request is sent (Phase 1 safety rail, ADR 0003).
 */
const ALLOWED: { method: string; path: RegExp }[] = [
  { method: 'POST', path: /^\/oauth\/oauth30\/token$/ },
  { method: 'GET', path: /^\/oauth\/oauth20\/token$/ },
  { method: 'GET', path: /^\/resellers\/v6\/catalog$/ },
  { method: 'GET', path: /^\/resellers\/v6\/catalog\/details$/ },
  { method: 'GET', path: /^\/resellers\/v6\/catalog\/details\/[A-Za-z0-9_-]+$/ },
  { method: 'POST', path: /^\/resellers\/v6\/catalog\/priceandavailability$/ },
];

export class EndpointNotAllowedError extends Error {}

export class IngramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly correlationId: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface ApiCallRecord {
  correlationId: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  attempt: number;
  error: string | null;
  /** Ingram's X-RateLimit-* headers on this reply, when sent. */
  rateLimit?: RateLimitInfo | null;
}

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: Date | null;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  /** Called after every HTTP attempt, for the call log. */
  onCall?: (record: ApiCallRecord) => void;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Give up waiting for a reply after this long (then retry like a network error). */
  timeoutMs?: number;
}

export function assertAllowed(method: string, path: string): void {
  if (!ALLOWED.some((a) => a.method === method && a.path.test(path))) {
    throw new EndpointNotAllowedError(`Blocked: ${method} ${path} is not on the Phase 1 allowlist`);
  }
}

/** Ingram limits IM-CorrelationID to 32 characters, so a dashed UUID (36) is too long. */
export function newCorrelationId(): string {
  return randomUUID().replace(/-/g, '');
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Longest we'll wait, inside an update, for Ingram's rate-limit allowance to reset. Beyond this the
 * update stops with a message saying when to run it again (a catalog pull then continues where it stopped).
 */
export const MAX_RATE_LIMIT_WAIT_MS = 60 * 60_000;

export class IngramClient {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;
  private tokenStyle: 'oauth30' | 'oauth20' | null = null;
  private nextSlot = 0;
  /** Ingram said our allowance is used up until this time (ms since epoch). */
  private pausedUntil = 0;

  constructor(
    private readonly config: IngramConfig,
    private readonly options: ClientOptions = {},
  ) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = options.maxAttempts ?? 5;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  get environment(): string {
    return this.config.env;
  }

  async get<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<{ status: number; body: T }> {
    return this.call<T>('GET', path, query, undefined);
  }

  async post<T>(path: string, query: Record<string, string | number | boolean | undefined>, body: unknown): Promise<{ status: number; body: T }> {
    return this.call<T>('POST', path, query, body);
  }

  private async call<T>(
    method: string,
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    body: unknown,
  ): Promise<{ status: number; body: T }> {
    assertAllowed(method, path);
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

    let refreshedAfter401 = false;
    for (let attempt = 1; ; attempt++) {
      const correlationId = newCorrelationId();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.accessToken()}`,
        'IM-CustomerNumber': this.config.customerNumber,
        'IM-CountryCode': this.config.countryCode,
        'IM-CorrelationID': correlationId,
        Accept: 'application/json',
      };
      if (this.config.senderId) headers['IM-SenderID'] = this.config.senderId;
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      await this.waitForSlot();
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const message = this.networkErrorMessage(err);
        this.log({ correlationId, method, path, status: null, durationMs: Date.now() - started, attempt, error: message });
        if (attempt >= this.maxAttempts) throw new IngramApiError(`Network error: ${message}`, 0, correlationId, null);
        await this.sleep(backoffMs(attempt));
        continue;
      }
      const parsed = await readBody(res);
      const ok = res.ok;
      const rateLimit = readRateLimit(res);
      this.log({
        correlationId, method, path, status: res.status, durationMs: Date.now() - started, attempt,
        error: ok ? null : summarizeError(parsed), rateLimit,
      });
      // Allowance used up: hold the next request until Ingram's counter resets.
      if (rateLimit?.resetAt && (res.status === 429 || rateLimit.remaining === 0)) {
        this.pausedUntil = Math.max(this.pausedUntil, rateLimit.resetAt.getTime());
      }
      if (ok) return { status: res.status, body: parsed as T };

      if (res.status === 401 && !refreshedAfter401) {
        refreshedAfter401 = true;
        this.token = null;
        continue;
      }
      if (res.status === 429) {
        const wait = Math.max(this.pausedUntil - Date.now(), retryAfterMs(res) ?? 0);
        if (wait > MAX_RATE_LIMIT_WAIT_MS) throw rateLimitExhausted(Date.now() + wait, correlationId, parsed);
      }
      if (RETRYABLE.has(res.status) && attempt < this.maxAttempts) {
        // A known reset time is waited for in waitForSlot; otherwise back off.
        if (!(res.status === 429 && this.pausedUntil > Date.now())) await this.sleep(retryAfterMs(res) ?? backoffMs(attempt));
        continue;
      }
      const prefix = res.status === 429 ? `Ingram's rate limit: it asked us to slow down ${attempt} times in a row. ` : '';
      throw new IngramApiError(
        `${prefix}Ingram returned ${res.status} for ${method} ${path}: ${summarizeError(parsed)}`,
        res.status, correlationId, parsed,
      );
    }
  }

  private networkErrorMessage(err: unknown): string {
    if (err instanceof Error && err.name === 'TimeoutError') return `no reply from Ingram within ${Math.round(this.timeoutMs / 1000)} seconds`;
    return err instanceof Error ? err.message : String(err);
  }

  /**
   * Spaces requests out to stay under the configured requests-per-second, and holds them while
   * Ingram's rate-limit allowance is used up.
   */
  private async waitForSlot(): Promise<void> {
    const interval = 1000 / this.config.maxRequestsPerSecond;
    const now = Date.now();
    const paused = Math.max(0, this.pausedUntil - now);
    if (paused > MAX_RATE_LIMIT_WAIT_MS) throw rateLimitExhausted(this.pausedUntil, '', null);
    const wait = Math.max(paused, this.nextSlot - now);
    this.nextSlot = Math.max(now + paused, this.nextSlot) + interval;
    this.pausedUntil = 0;
    if (wait > 0) await this.sleep(wait);
  }

  private log(record: ApiCallRecord): void {
    this.options.onCall?.(record);
  }

  /**
   * Ingram's own spec disagrees with itself about the token endpoint: the security scheme says
   * POST /oauth/oauth30/token (standard client credentials), the path list says
   * GET /oauth/oauth20/token with query parameters. Try oauth30 first, fall back to oauth20,
   * and remember whichever works.
   */
  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const styles: ('oauth30' | 'oauth20')[] = this.tokenStyle ? [this.tokenStyle] : ['oauth30', 'oauth20'];
    let lastError: unknown;
    for (const style of styles) {
      try {
        const token = await this.requestToken(style);
        this.tokenStyle = style;
        // expires_in arrives as a string; refresh five minutes early.
        const seconds = Number(token.expires_in) || 3600;
        this.token = { value: token.access_token, expiresAt: Date.now() + Math.max(60, seconds - 300) * 1000 };
        return this.token.value;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  private async requestToken(style: 'oauth30' | 'oauth20'): Promise<{ access_token: string; expires_in?: string | number }> {
    const { clientId, clientSecret } = this.config;
    const method = style === 'oauth30' ? 'POST' : 'GET';
    const path = `/oauth/${style}/token`;
    assertAllowed(method, path);
    const url = new URL(this.config.authBaseUrl + path);
    const init: RequestInit = { method, headers: { Accept: 'application/json' } };
    if (style === 'oauth30') {
      init.headers = { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' };
      init.body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString();
    } else {
      url.searchParams.set('grant_type', 'client_credentials');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('client_secret', clientSecret);
    }

    for (let attempt = 1; ; attempt++) {
      const correlationId = newCorrelationId();
      await this.waitForSlot();
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        const message = this.networkErrorMessage(err);
        this.log({ correlationId, method, path, status: null, durationMs: Date.now() - started, attempt, error: message });
        if (attempt >= this.maxAttempts) throw new IngramApiError(`Network error during sign-in: ${message}`, 0, correlationId, null);
        await this.sleep(backoffMs(attempt));
        continue;
      }
      const parsed: any = await readBody(res);
      const ok = res.ok && typeof parsed?.access_token === 'string';
      const rateLimit = readRateLimit(res);
      if (rateLimit?.resetAt && (res.status === 429 || rateLimit.remaining === 0)) {
        this.pausedUntil = Math.max(this.pausedUntil, rateLimit.resetAt.getTime());
      }
      this.log({ rateLimit,
        correlationId, method, path, status: res.status, durationMs: Date.now() - started, attempt,
        error: ok ? null : summarizeError(parsed),
      });
      if (ok) return parsed;
      if (res.status === 429 && this.pausedUntil - Date.now() > MAX_RATE_LIMIT_WAIT_MS) throw rateLimitExhausted(this.pausedUntil, correlationId, parsed);
      if (RETRYABLE.has(res.status) && attempt < this.maxAttempts) {
        if (!(res.status === 429 && this.pausedUntil > Date.now())) await this.sleep(retryAfterMs(res) ?? backoffMs(attempt));
        continue;
      }
      throw new IngramApiError(`Sign-in failed (${style}, HTTP ${res.status}): ${summarizeError(parsed)}`, res.status, correlationId, parsed);
    }
  }
}

/** Exponential backoff with jitter: about 2s, 4s, 8s, 16s... capped at 60s. */
export function backoffMs(attempt: number): number {
  const base = Math.min(60_000, 1000 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Ingram's X-RateLimit-Limit / -Remaining / -Reset headers. Reset is documented as Unix time; a small
 * number is read as "seconds from now" in case some endpoints send that instead.
 */
export function readRateLimit(res: Response, now = Date.now()): RateLimitInfo | null {
  const n = (name: string) => {
    const v = res.headers.get(name);
    if (v == null || v.trim() === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const limit = n('x-ratelimit-limit');
  const remaining = n('x-ratelimit-remaining');
  const reset = n('x-ratelimit-reset');
  if (limit === null && remaining === null && reset === null) return null;
  let resetAt: Date | null = null;
  if (reset !== null) resetAt = new Date(reset > 1e12 ? reset : reset > 1e9 ? reset * 1000 : now + reset * 1000);
  return { limit, remaining, resetAt };
}

function rateLimitExhausted(untilMs: number, correlationId: string, body: unknown): IngramApiError {
  const at = new Date(untilMs).toLocaleString('en-CA', { timeZone: 'America/Vancouver', dateStyle: 'medium', timeStyle: 'short' });
  return new IngramApiError(
    `Ingram's rate limit: our allowance is used up until ${at} (Pacific). Run the update again after that; a catalog pull continues where it stopped.`,
    429, correlationId, body,
  );
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeError(body: any): string {
  if (body == null) return 'no response body';
  if (typeof body === 'string') return body.slice(0, 300);
  const first = body.errors?.[0];
  if (first) {
    const fields = (first.fields ?? []).map((f: any) => `${f.field}: ${f.message}`).join('; ');
    return [first.message, fields].filter(Boolean).join(' - ');
  }
  return body.fault?.faultstring ?? body.message ?? body.error_description ?? body.error ?? JSON.stringify(body).slice(0, 300);
}
