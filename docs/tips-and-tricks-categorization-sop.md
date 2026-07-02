# Tips-and-Tricks Categorization SOP

**Audience:** Any BTS admin reviewing Knowledge Base drafts
**Applies to:** The weekly "tips and tricks" content (e.g. Nano Banana, Grok Imagine, Anstrex native ad copy, headline formulas)
**Where you use it:** Admin → Knowledge Base → Document Review (the taxonomy editor on each draft)

---

## What "tips and tricks" content is

The weekly tips series are short, tool-driven walkthroughs that show a member how to
get one specific thing done — usually make or improve a creative, or write copy — often
using a named piece of software. They are *not* full curriculum modules and *not*
coaching-call recordings. Examples currently in the queue:

- **Nano Banana** — make / resize ad creatives in Google AI Studio (Gemini).
- **Grok Imagine** — turn a static image into a short video / animated GIF.
- **Anstrex + Claude** — find winning native ads and rewrite the copy.
- **Headlines in a specific style** — generate headlines with Claude using the copy docs.
- **Caterpillar creative optimization** — refresh a working campaign's creatives with AI.

---

## The two things that never change for tips content

These are set at intake and you should **leave them as-is**:

| Field | Value | Why |
|---|---|---|
| **Format** (source folder) | `Other Video` (`other_video`) | Tips are short single-presenter videos, not coaching calls or Blitz modules. |
| **Authority** | `Curriculum` | A BTS presenter is teaching; there is no member/coach dialogue to attribute. |
| **Doc class** | `transcript` (training-only, **non-citable**) | Tips feed the AI as *source material* to mine — they are never cited to members directly. Do not promote a tip to `curated` or `overview`. |

If any of these arrive set to something else, correct them back to the values above.

---

## The one decision you actually make: home root + node

Every tip gets exactly **one home root** and **one dominant node**. Use this test:

### Step 1 — Pick the home root

Ask: *"Is this a repeatable step in building a campaign, or a transferable skill?"*

- **A repeatable campaign build step** ("do this, then this to produce the asset") →
  **Process** (`process`).
- **A cross-campaign skill or principle** ("how to think about copy / angles / testing"
  that you reuse on any campaign) → **Concepts & Skills** (`concepts`).

Tips are almost never **Operations** (that root is membership / billing / support).

### Step 2 — Pick the dominant node

**Process nodes** (most tips land here — they show you how to make an asset):

- `creative-assets` — **the default for tips.** Making, resizing, animating, or editing
  images / video / GIFs for ads or landing pages.
- Other process nodes only if the tip is clearly about that stage: `tracking-and-setup`,
  `launch`, `testing`, `scaling`, `network-and-offer`, `foundations`, `compliance`.

**Concepts nodes** (skill/principle tips):

- `headlines-and-copy` — writing headlines, descriptions, ad copy.
- `creative-strategy` — *how to think about* creatives (what makes one work), as opposed
  to the mechanical steps of building one.
- `testing-methodology` — how to structure / read tests.
- `angles` — choosing the marketing angle.

### Step 3 — One tip, one dominant node

A tip often touches several nodes (a headline tip built on a spy tool touches copy *and*
creative *and* research). **Pick the single most dominant node** — the thing the tip is
really teaching. Do **not** try to record every related node here; secondary links are
added later, automatically, at the synthesis stage.

> Rule of thumb: if the tip's payoff is *an asset you produced*, it's a Process /
> `creative-assets` tip. If the payoff is *a way of writing or thinking* you'd reuse, it's
> a Concepts tip.

---

## Software is a tool tag, never a node

The specific software a tip uses (Nano Banana, Grok, Claude, Anstrex, Canva, …) is a
**tool tag**, not a taxonomy node. Never create or pick a node named after a tool.

- If the tool is already in the tag list, add it as a tag (0–4 tags per doc).
- If the tool is **new** (not in the tag list), the AI analysis records it in the
  tool-tag **proposal queue** for an admin to approve — it does not become a live tag on
  its own. You can approve or reject it under the tool-tag admin surface.

---

## Worked examples (the current queue)

| Tip | Home root | Dominant node | Tool tags | Why |
|---|---|---|---|---|
| Nano Banana — make/resize creatives | `process` | `creative-assets` | `nano-banana`, `caterpillar` | Produces an ad image — a build step. |
| Grok Imagine — image → video/GIF | `process` | `creative-assets` | `grok` | Produces a video/GIF creative — a build step. |
| Anstrex + Claude — native ad copy | `concepts` | `headlines-and-copy` | `anstrex`, `claude` | Teaches how to write copy — a reusable skill. |
| Headlines in a specific style | `concepts` | `headlines-and-copy` | `claude` | Teaches a headline-writing method — a reusable skill. |
| Caterpillar creative optimization | `process` | `creative-assets` | `caterpillar` | Refreshes/edits campaign creatives — a build step. |

Each also links to a secondary node in real life (e.g. the Anstrex tip touches
`creative-strategy`; the Grok tip touches `headlines-and-copy` through its example). You
still pick only the **dominant** node above — synthesis handles the rest.

---

## Nothing auto-publishes

The AI analysis only **suggests** the home root, node, tags, and the cleaned title. Every
suggestion lands in `needs_review` for you to accept or change in the taxonomy editor, and
nothing goes to members until a human approves it. Edit any suggestion you disagree with —
your choice is the one that sticks.

---

## Quick reference

| You see… | Do this |
|---|---|
| A tip that makes/edits an image, video, or GIF | `process` / `creative-assets` |
| A tip about writing headlines or ad copy | `concepts` / `headlines-and-copy` |
| A tip about *how to think about* creatives | `concepts` / `creative-strategy` |
| A tip about structuring or reading tests | `concepts` / `testing-methodology` |
| A software name (Nano Banana, Grok, Claude, …) | Tool **tag**, never a node |
| Format / authority / doc class arrived wrong | Reset to `other_video` / `curriculum` / `transcript` |
| Tip touches several nodes | Pick the **dominant** one; synthesis links the rest |
