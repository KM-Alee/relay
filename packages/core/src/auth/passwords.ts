// Password hashing (docs/06-security.md §1, ADR-0004, Q1): argon2id via @node-rs/argon2 with the OWASP
// minimum (m=19456 KiB, t=2, p=1). Parameters live inside the PHC string, so they can be raised later:
// `needsRehash()` tells login to re-hash with the current params after a successful verify.
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { isCommonPassword } from './common-passwords';

export const ARGON2_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
/** Algorithm.Argon2id (a `const enum` in the package typings, so the literal is used here). */
const ARGON2ID = 2;

export const PASSWORD_MIN_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, { ...ARGON2_PARAMS, algorithm: ARGON2ID });
}

/** Constant-time verify inside argon2. Malformed hashes verify as false (never throw to callers). */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

/** True when the stored hash uses another algorithm or weaker/different params than ARGON2_PARAMS. */
export function needsRehash(passwordHash: string): boolean {
  const m = PHC.exec(passwordHash);
  if (!m) return true;
  return (
    Number(m[1]) !== ARGON2_PARAMS.memoryCost ||
    Number(m[2]) !== ARGON2_PARAMS.timeCost ||
    Number(m[3]) !== ARGON2_PARAMS.parallelism
  );
}

export type PasswordProblem = 'too_short' | 'too_common';

/** 06 §1: ≥ 10 characters and not a common password. No composition rules. */
export function passwordProblem(password: string): PasswordProblem | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (isCommonPassword(password)) return 'too_common';
  return null;
}

let dummy: Promise<string> | undefined;
/**
 * Verify against a throwaway hash when the email is unknown, so "no such user" costs the same time as
 * "wrong password" (no user enumeration by timing).
 */
export async function burnVerifyTime(password: string): Promise<void> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummy, password);
}
