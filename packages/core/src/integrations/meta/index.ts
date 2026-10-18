// Meta WhatsApp Cloud API adapter + fake (docs/04-integrations.md §3). Owner: Lane C (T-141).
export {
  createMetaAdapter,
  classifyMetaError,
  metaSignature,
  toE164,
  DEFAULT_GRAPH_VERSION,
} from './adapter';
export {
  createFakeMeta,
  signedMetaRequest,
  metaInboundPayload,
  metaStatusPayload,
  type FakeMeta,
} from './fake';
