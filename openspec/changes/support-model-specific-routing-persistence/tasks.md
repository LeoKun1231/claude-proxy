## 1. Config Schema And Migration

- [x] 1.1 Extend `server/config-store.js` with a versioned config shape that includes `modelRoutes` and backward-compatible defaults
- [x] 1.2 Implement legacy-to-new config hydration so existing `providers` and `mapping` data continue to load correctly after upgrade
- [x] 1.3 Update config write flow to persist the new schema safely under `DATA_DIR/config.json`, including atomic file replacement

## 2. Proxy Routing Logic

- [x] 2.1 Refactor `server/proxy-server.js` to resolve route settings from the incoming request model before applying legacy mapping fallback
- [x] 2.2 Add request/response logging for route hits, legacy fallback, and missing-route errors so routing decisions are diagnosable
- [x] 2.3 Update `server/index.js` configuration APIs and target derivation to expose model-specific routes alongside legacy provider data

## 3. Configuration UI

- [x] 3.1 Add a model-route management UI that supports creating, editing, enabling, disabling, and deleting multiple routes with source model, target model, provider, base URL, and API key fields
- [x] 3.2 Adjust `src/components/ModelMapping.tsx` and related renderer types so the UI reflects route-based behavior and legacy fallback state instead of a single global target selector
- [x] 3.3 Ensure frontend save/load flows persist route edits through the existing config API without breaking current provider configuration screens

## 4. Persistence And Verification

- [x] 4.1 Document the new config model and Docker persistence contract in `README.md` and keep `docker-compose.yml` aligned with `DATA_DIR` volume usage
- [x] 4.2 Manually verify that saved routes survive service restart and Docker container recreation when the same data volume is mounted
- [x] 4.3 Run `npm run build` and perform a smoke test covering route match, legacy fallback, and persisted reload behavior
