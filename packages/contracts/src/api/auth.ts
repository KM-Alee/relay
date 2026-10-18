// Auth contracts: sign up, log in, log out, dev login (docs/11-api.md "Auth & session", 06 §1). Owner: Lane B.
// Signup/login answer with the same shape as GET /api/v1/me, so the client can render immediately.
import { z } from 'zod';
import { endpoint } from './endpoint';
import { localeSchema, meResponse } from './users';

/** 06 §1: min 10 chars (top common passwords are rejected server-side), max bounds argon2 input. */
export const passwordSchema = z.string().min(10).max(256);
export const emailSchema = z.email().max(254);

export const signupBody = z
  .object({
    workspaceName: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    email: emailSchema,
    password: passwordSchema,
    locale: localeSchema.optional(),
    /** IANA zone, e.g. 'Asia/Karachi' (default). */
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();
export type SignupBody = z.infer<typeof signupBody>;

export const loginBody = z
  .object({
    email: emailSchema,
    // No min length on login: an old/short password just fails like any wrong one.
    password: z.string().min(1).max(256),
  })
  .strict();
export type LoginBody = z.infer<typeof loginBody>;

/** 204 responses parse `undefined`. */
export const noContent = z.undefined();

export const devLoginAsBody = z.object({ userId: z.uuid() }).strict();

export const seedUserSummary = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  baseLevel: z.enum(['owner', 'admin', 'user']),
  roles: z.array(z.string()),
  workspaceName: z.string(),
});
export const devSeedUsersResponse = z.object({ users: z.array(seedUserSummary) });

export const authEndpoints = {
  /** POST /api/v1/auth/signup: new workspace + Owner, signs in (sets the session cookie). */
  signup: endpoint({ method: 'POST', path: '/api/v1/auth/signup', body: signupBody, response: meResponse }),
  /** POST /api/v1/auth/login: rate-limited (Q1); same error for unknown email and wrong password. */
  login: endpoint({ method: 'POST', path: '/api/v1/auth/login', body: loginBody, response: meResponse }),
  /** POST /api/v1/auth/logout: revokes the current session, clears the cookie. Always 204. */
  logout: endpoint({ method: 'POST', path: '/api/v1/auth/logout', response: noContent }),
  /** GET /api/dev/login-as: seed users (404 unless NODE_ENV=development + DEMO_MODE). */
  devSeedUsers: endpoint({ method: 'GET', path: '/api/dev/login-as', response: devSeedUsersResponse }),
  /** POST /api/dev/login-as: sign in as a seed user (same guard). */
  devLoginAs: endpoint({
    method: 'POST',
    path: '/api/dev/login-as',
    body: devLoginAsBody,
    response: meResponse,
  }),
} as const;
