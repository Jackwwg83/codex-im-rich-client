// @codex-im/testkit — fakes and fixtures for testing AppServerClient + downstream.

export { createInMemoryTransportPair } from "./in-memory-transport.js";
export { FakeAppServer } from "./fake-app-server.js";
export type { FakeRequestHandler } from "./fake-app-server.js";
export { loadFixture, loadFixtureMetadata, loadFixtureText } from "./fixture-replay.js";
export type { FixtureMetadata } from "./fixture-replay.js";
