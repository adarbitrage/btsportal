---
name: Vidalytics videos aren't plain-iframe embeddable
description: Vidalytics account/video URLs (e.g. the 7 Pillars video) require the JS loader; requesting the embed base URL directly 403s, so a plain <iframe src> can never render it.
---

Any place that needs a real, playable video behind a plain `<iframe src={url}>` (not the `VidalyticsEmbed` JS-loader component) cannot use a Vidalytics-hosted video — confirmed by requesting `https://fast.vidalytics.com/embeds/{account}/{videoId}/` directly, which returns a 403 AccessDenied without the client-side loader script running.

**Why:** Vidalytics serves its player through a JS loader (`loader.min.js` + `player.min.js` injected by `VidalyticsEmbed`), not a static iframe-embeddable document. There is no known direct-iframe URL variant for the same account/video.

**How to apply:** For any dummy/placeholder/test video that must render through a real `<iframe src>` mechanism, use an internal, already-hosted, non-Vidalytics video instead (e.g. one of the portal's static `public/videos/*.mp4` files — browsers render these natively inside an iframe). Never assume a Vidalytics loader URL will work as a plain iframe src.
