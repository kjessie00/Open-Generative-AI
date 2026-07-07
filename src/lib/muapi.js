// Re-export shim for the deprecated MuAPI client.
// Older studio modules under src/_deprecated_legacy_muapi/ still reference
// '../lib/muapi.js'. The actual client lives next to those legacy studios so
// the pipeline isolation stays clean. This file only bridges the legacy
// import paths and is not consumed by the Cinematic Pipeline Studio.
export { muapi } from '../_deprecated_legacy_muapi/muapi.js';
