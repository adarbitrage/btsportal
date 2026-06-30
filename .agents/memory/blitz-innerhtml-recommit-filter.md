---
name: dangerouslySetInnerHTML re-commit wipes DOM filtering
description: Why DOM-manipulating filtered content injected via dangerouslySetInnerHTML must self-heal with a MutationObserver
---

The Blitz guide body is injected with `dangerouslySetInnerHTML` (a constant
string). The section filter then sets inline `display:none` on non-matching
`.module[data-section]` blocks via direct DOM manipulation.

**Trap:** React owns that subtree. When ANY unrelated async re-render commits —
most notably the content-access guard's React Query (`useContentAccess`)
resolving ~100–600ms after mount — React **re-applies the innerHTML**, silently
replacing every child with a fresh, *unfiltered* copy. It does this while
**reusing the same host DOM node** (the ref callback never re-fires, `contentEl`
state and any `mountTick` don't change) and **without re-running the layout
effect**. Symptom: a single-lesson URL filters correctly for a beat, then snaps
back to the full guide.

**Why:** value-stable `__html` means React skips innerHTML on re-render — but on
the commit that DOES re-set it, it blows away every out-of-band DOM mutation.
Bumping a `mountTick` on ref-attach does NOT help (ref isn't re-called). A single
`useLayoutEffect` pass does NOT help (effect doesn't re-run).

**How to apply:** any time you filter/annotate `dangerouslySetInnerHTML` content
by mutating the DOM, make it self-healing: extract the mutation into a function
and re-invoke it from a `MutationObserver` watching the host for `childList`
changes (added/removed module nodes). The mutation only touches inline `style`
attributes, so a childList-only observer never feedback-loops. Scroll-to-top and
other one-shot side effects must stay OUTSIDE the re-applied function so a
background rebuild doesn't yank the user's scroll.

Diagnosing this: a persistent (non-self-disconnecting) MutationObserver on the
host with `{childList:true, subtree:true}` reveals the re-commit as a single
record with ~equal added/removed counts on the content div itself. A
self-disconnecting observer misses it because the lightbox's benign
`#vdLightbox` removal fires first.
