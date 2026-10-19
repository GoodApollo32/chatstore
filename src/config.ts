// Runtime settings. Secrets and machine-specific values come only from environment variables;
// the product scope (manufacturers, categories) lives in config/scope.json.

export type IngramEnv = 'sandbox' | 'production';

export interface IngramConfig {
  clientId: string;
  clientSecret: string;
  customerNumber: string;
  countryCode: string;
  env: IngramEnv;
  senderId: string | undefined;
  /** Host + optional sandbox prefix, e.g. https://api.ingrammicro.com:443/sandbox */
  baseUrl: string;
  /** Host only; the token endpoint never carries the sandbox prefix. */
  authBaseUrl: string;
  maxRequestsPerSecond: number;
}

export interface ScheduleConfig {
  enabled: boolean;
  timezone: string;
  catalogTimes: string[];
  refreshTimes: string[];
  /** When set, the price & stock refresh also runs every N minutes (for short test windows). */
  refreshEveryMinutes: number | undefined;
}

export interface AppConfig {
  databaseUrl: string;
  port: number;
  scopeFile: string;
  schedule: ScheduleConfig;
}

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing setting ${name}. Add it to the .env file (see .env.example).`);
  return value;
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === '') return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadIngramConfig(env: Env = process.env): IngramConfig {
  const ingramEnv = (env.INGRAM_ENV?.trim() || 'sandbox') as IngramEnv;
  if (ingramEnv !== 'sandbox' && ingramEnv !== 'production') {
    throw new Error(`INGRAM_ENV must be "sandbox" or "production", got "${ingramEnv}"`);
  }
  const host = (env.INGRAM_API_HOST?.trim() || 'https://api.ingrammicro.com:443').replace(/\/+$/, '');
  return {
    clientId: required(env, 'INGRAM_CLIENT_ID'),
    clientSecret: required(env, 'INGRAM_CLIENT_SECRET'),
    customerNumber: required(env, 'INGRAM_CUSTOMER_NUMBER'),
    countryCode: env.INGRAM_COUNTRY_CODE?.trim() || 'CA',
    env: ingramEnv,
    senderId: env.INGRAM_SENDER_ID?.trim() || undefined,
    baseUrl: ingramEnv === 'sandbox' ? `${host}/sandbox` : host,
    authBaseUrl: host,
    maxRequestsPerSecond: Number(env.INGRAM_MAX_REQUESTS_PER_SECOND ?? '1') || 1,
  };
}

// Ingram settings are loaded separately (loadIngramConfig) so the search page and report work
// even before keys are in place.
export function loadConfig(env: Env = process.env): AppConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    port: Number(env.PORT ?? '8080'),
    scopeFile: env.SCOPE_FILE?.trim() || 'config/scope.json',
    schedule: {
      enabled: env.SCHEDULE_ENABLED?.trim().toLowerCase() === 'true',
      timezone: env.SCHEDULE_TIMEZONE?.trim() || 'America/Vancouver',
      catalogTimes: list(env.SCHEDULE_CATALOG_TIMES, ['02:00']),
      refreshTimes: list(env.SCHEDULE_REFRESH_TIMES, ['06:00', '13:00']),
      refreshEveryMinutes: env.SCHEDULE_REFRESH_EVERY_MINUTES
        ? Number(env.SCHEDULE_REFRESH_EVERY_MINUTES)
        : undefined,
    },
  };
}
