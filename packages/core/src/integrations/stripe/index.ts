// Stripe (test mode) adapter + fake (docs/04-integrations.md §4). Owner: Lane C (T-143).
export {
  createStripeAdapter,
  mapStripeError,
  STRIPE_API_VERSION,
  WEBHOOK_TOLERANCE_SECONDS,
} from './adapter';
export { createFakeStripe, signStripePayload, stripeEventBody, type FakeStripe } from './fake';
