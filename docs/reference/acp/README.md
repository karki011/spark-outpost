# ACP v1 schema

`schema.json` is the Agent Client Protocol v1 JSON Schema (draft 2020-12), copied on November 9, 2026 from `schema/v1/schema.json` in `@agentclientprotocol/sdk` 2.4.0, the SDK version Spark pins. It is kept byte for byte as shipped, so Prettier skips it.

- Source: `node_modules/@agentclientprotocol/sdk/schema/v1/schema.json` (stable v1; the SDK's `schema.unstable.json` beside it adds the unstable features)
- SHA-256 prefix: `0d0b1ca83c4872e5`
- What Spark Outpost supports is tracked in `docs/architecture/ACP_COVERAGE.md`.

To update it after an SDK upgrade, copy the new SDK's `schema/v1/schema.json` over it, update the version, date and hash above, and re-run `pnpm acp:coverage`.
