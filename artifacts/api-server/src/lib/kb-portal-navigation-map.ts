/**
 * Current BTS portal navigation map (Task #3, foundation §8.1).
 *
 * The registry now LIVES in the shared workspace package
 * `@workspace/portal-nav-map` (Task #1778) so the portal-side drift guard can
 * compare it against the real member sidebar (`MEMBER_NAV`) without the
 * api-server importing portal React code. This module stays as the api-server
 * seam: every existing import path keeps working.
 */

export type { NavItem, NavSection } from "@workspace/portal-nav-map";
export {
  PORTAL_NAVIGATION_MAP,
  flattenNavigationMap,
  renderNavigationMapLines,
  canonicalNavMapSnapshot,
  computeNavMapVersion,
  diffNavMaps,
  changeReferenceTokens,
  isStaffRoutePath,
  NAV_MAP_ONLY_PATHS,
  STAFF_ROUTE_PREFIXES,
} from "@workspace/portal-nav-map";
export type { NavMapChange } from "@workspace/portal-nav-map";
