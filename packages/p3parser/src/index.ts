// Clean client API (recommended entry point)
export * from "./clientTypes.js";
export { P3DecoderConnection } from "./P3DecoderConnection.js";
export type { ConnectionOptions, DecoderConnectionCallbacks } from "./P3DecoderConnection.js";
export { P3DecoderDiscovery } from "./P3DecoderDiscovery.js";
export type { DiscoveryCallbacks, DiscoveryOptions } from "./P3DecoderDiscovery.js";
export { P3DecoderPool } from "./P3DecoderPool.js";
export type { DecoderPoolCallbacks, PoolDecoderState, PoolOptions } from "./P3DecoderPool.js";

// Low-level protocol access (parser, stream, builder, wire types)
export * from "./types.js";
export * from "./parser.js";
export * from "./stream.js";
export * from "./builder.js";
