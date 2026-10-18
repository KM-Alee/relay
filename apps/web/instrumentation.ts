// Server boot hook (Next.js). Fails fast on a broken core/db env (T-003, Q13), with one clear message
// listing every missing variable. Other sections are validated lazily when first used.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { validateConfig } = await import('@relay/core/config');
  validateConfig(['core', 'db']);
  await import('@relay/core/services/register-hooks'); // lead-engine hooks (each route bundle also imports it)
}
