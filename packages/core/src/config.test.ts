import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, createConfig, validateConfig } from './config';

const key = () => randomBytes(32).toString('base64');
const base = {
  NODE_ENV: 'development',
  PUBLIC_BASE_URL: 'http://localhost:3000',
  APP_ENCRYPTION_KEY: key(),
  SESSION_SECRET: key(),
  DATABASE_URL: 'postgres://app_user:pw@localhost:5432/relay',
};

describe('[Q13] config validation', () => {
  it('[Q13] parses a valid env with defaults', () => {
    const c = createConfig({ ...base, DEMO_MODE: 'true' });
    expect(c.core.PUBLIC_BASE_URL).toBe('http://localhost:3000');
    expect(c.core.DEMO_MODE).toBe(true);
    expect(c.jobs.TICK_BUDGET_MS).toBe(20_000);
    expect(c.ai.AI_ENABLED).toBe(false);
    expect(c.testing.GITHUB_REF).toBe('main');
  });

  it('[Q13] boot fails clearly, listing every missing var by name', () => {
    let err: unknown;
    try {
      validateConfig(['core', 'db'], { NODE_ENV: 'development', APP_ENCRYPTION_KEY: '' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as ConfigError).message;
    for (const name of ['PUBLIC_BASE_URL', 'APP_ENCRYPTION_KEY', 'SESSION_SECRET', 'DATABASE_URL']) {
      expect(msg).toContain(`${name} is required`);
    }
    expect(msg).toContain('.env.example');
  });

  it('[Q13] sections are lazy: an unrelated broken section does not break others', () => {
    const c = createConfig({ ...base, STRIPE_SECRET_KEY: 'sk_live_oops' });
    expect(c.core.PUBLIC_BASE_URL).toBeDefined();
    expect(() => c.stripe).toThrow(/STRIPE_SECRET_KEY must be a TEST key/);
  });

  it('[Q13] never echoes secret values in errors', () => {
    const secret = 'sk_live_TOPSECRET123';
    expect(() => createConfig({ ...base, STRIPE_SECRET_KEY: secret }).stripe).toThrow(ConfigError);
    try {
      void createConfig({ ...base, STRIPE_SECRET_KEY: secret }).stripe;
    } catch (e) {
      expect((e as Error).message).not.toContain('TOPSECRET');
    }
  });

  it('[Q13][F1.6] refuses a runtime DATABASE_URL that is not app_user (outside tests)', () => {
    const c = createConfig({ ...base, DATABASE_URL: 'postgres://postgres:pw@localhost:5432/relay' });
    expect(() => c.db).toThrow(/DATABASE_URL must connect as role app_user/);
  });

  it('[Q13][F1.6] accepts an owner DATABASE_URL when APP_DB_PASSWORD lets the runtime rewrite it to app_user', () => {
    const c = createConfig({
      ...base,
      DATABASE_URL: 'postgres://neondb_owner:pw@localhost:5432/relay',
      APP_DB_PASSWORD: 'app-pw',
    });
    expect(() => c.db).not.toThrow();
  });

  it('[Q13] rejects a short encryption key and placeholder-only provider values count as unset', () => {
    expect(() => createConfig({ ...base, APP_ENCRYPTION_KEY: 'c2hvcnQ=' }).core).toThrow(
      /APP_ENCRYPTION_KEY must be base64/,
    );
    const c = createConfig({ ...base, STRIPE_SECRET_KEY: 'sk_test_', STRIPE_WEBHOOK_SECRET: 'whsec_' });
    expect(c.stripe.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('[Q15] AI_ENABLED=true without a key fails; AI_ENABLED=false works', () => {
    expect(() => createConfig({ ...base, AI_ENABLED: 'true' }).ai).toThrow(
      /OPENAI_API_KEY is required when AI_ENABLED=true/,
    );
    expect(createConfig({ ...base, AI_ENABLED: 'false' }).ai.AI_ENABLED).toBe(false);
  });

  it('[Q13] INTEGRATIONS_FAKE is refused in production', () => {
    expect(() => createConfig({ ...base, NODE_ENV: 'production', INTEGRATIONS_FAKE: '1' }).testing).toThrow(
      /INTEGRATIONS_FAKE must not be enabled in production/,
    );
  });

  it('[Q13] notifications section holds the Slack vars', () => {
    const c = createConfig({ ...base, SLACK_BOT_TOKEN: 'xoxb-1', SLACK_SIGNING_SECRET: 's' });
    expect(c.notifications.SLACK_BOT_TOKEN).toBe('xoxb-1');
    expect(c.notifications.SLACK_TEAM_ID).toBeUndefined();
  });
});
