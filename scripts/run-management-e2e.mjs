// Reuse the existing harness, which creates and removes a guarded temporary schema.
process.env.STORE_E2E_SUITE = "management";
await import("./run-store-e2e.mjs");
