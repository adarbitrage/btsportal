/**
 * Backend re-export of the canonical Blitz curriculum skeleton.
 *
 * The single source of truth now lives in the `@workspace/blitz-curriculum`
 * workspace package, shared by both the portal and this api-server. This file
 * is a thin re-export kept so existing backend imports
 * (`../lib/blitz/sections`) continue to resolve unchanged.
 *
 * Do not add data here — edit `lib/blitz-curriculum/src/index.ts` instead.
 */

export * from "@workspace/blitz-curriculum";
