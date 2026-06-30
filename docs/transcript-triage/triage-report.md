# Transcript Database Triage — Report

> **Task #1483.** Deep-dive triage of the legacy `transcript`-class documents in
> `knowledgebase_docs` (doc_class = `transcript`). **Nothing has been copied, stitched,
> moved, or mutated.** This report and its companion `manifest.json` are the human-reviewed
> source of truth that gates the import (plan #1484); the structure findings double as the
> enhancement spec for the Transcript Cleaner (plan #1468 — see `findings-report.md`).

**Companion files:** `manifest.json` (machine-readable, one entry per doc) · `findings-report.md` (transcript-structure findings + cleaner spec).

## How to review
Read this report, then flip anything you disagree with **in `manifest.json`** — change a
`disposition`, move a `folder`, fix an `authorityRole`, edit a `proposedTitle`, or move ids
between `keepDocIds` and `duplicateDropDocIds`. The reviewed manifest is the contract plan
#1484 imports from. Start with the **Human-review queue** below — those are the calls most
worth your eyes.

**Renaming.** Every keeper has a `proposedTitle` — the clean name the import (#1484) will give
the stitched single document, replacing the raw `… (Part N)` chunk titles. For most recordings
this is just the de-suffixed series name; for the **generic/misnamed** calls it is an explicit
new title (shown in **bold**, `titleRenamed: true` in the manifest). Edit any `proposedTitle`
you'd word differently — the import applies whatever the approved manifest says.

## Totals

| Metric | Count |
|---|---|
| Documents (DB rows) total | 485 |
| Logical recordings (after grouping parts + de-duping) | 161 |
| → Keep | 149 recordings / 388 doc-parts |
| → Exclude (internal/non-member) | 12 recordings / 59 docs |
| Duplicate doc-parts to drop (within keepers) | 38 |
| Flagged for human review | 10 recordings |

**Keepers by folder:** Group Coaching 29 · Private Coaching 3 · 1-on-1 VA 7 · Blitz Video 26 · Other Video 71 · Reference Docs 13

**Keepers by authority role:** strategic_coach 32 · va 7 · curriculum 110

**Vocabulary.** Folders match plan #1482's categories. Authority roles mirror the live
`coaches.type` vocabulary (`strategic_coach` = Bruce, Michael, Sasha, Todd; `va` = John,
Neil, Mikha, Aliena/support) plus `curriculum` (official training) and `internal`
(quarantined). VA-sourced *strategic* claims must not be weighted as truth (see #1468 spec).

## ⚑ Human-review queue (10)

These were adjudicated **by reading content**, sometimes against the name-based seed list in
`docs/ai-assistant-remediation-foundation.md` §8.11. Confirm or flip each.

| Group | Original title | Suggested | Proposed clean title | Folder / role | Why it needs your eyes |
|---|---|---|---|---|---|
| G1 | Adam Field Meeting Information | **keep** | **Private Coaching — Adam Field (Coach Sasha)** | Private Coaching / strategic_coach | §8.11 name-scan flagged 'Adam Field Meeting Information' as internal; CONTENT reads as a 1:1 member campaign-coaching call. Confirm Adam Field is a member, not staff. |
| G3 | Dara Dameron Meeting Information | **keep** | **Private Coaching — Dara Dameron (Coach Sasha)** | Private Coaching / strategic_coach | §8.11 listed 'Dara Dameron Meeting Information' as ambiguous/default-quarantine; CONTENT reads as a 1:1 member coaching call. Confirm Dara is a member. |
| G18 | John Freese _ Mark Blyn | **exclude** | — | — / internal | A member (John Freese) IS present, but the call is an executive retention/relationship discussion with CEO Mark Blyn and COO Jean, not campaign coaching. Suggested exclude; human may reconsider. |
| G47 | TCE Concierge Coaching Weekly | **exclude** | — | — / internal | §8.11 marks the TCE/Concierge weeklies ambiguous; CONTENT confirms an internal staff coordination meeting (COO + VAs + CEO on coaches'-call staffing). Suggested exclude. |
| G48 | TCE SUPPORT COACHING WEEKLY | **exclude** | — | — / internal | §8.11 ambiguous; CONTENT confirms internal support-team meeting. Suggested exclude. |
| G49 | TCE SUPPORT COACHING WEEKLY(1) | **exclude** | — | — / internal | §8.11 ambiguous; CONTENT confirms internal staff meeting. Suggested exclude. |
| G50 | TCE Support Coaching Weekly(2) | **exclude** | — | — / internal | §8.11 ambiguous; CONTENT confirms internal staff meeting. Suggested exclude. |
| G51 | Untitled document | **keep** | **Live Coaching Call — Michael (session A)** | Group Coaching / strategic_coach | Title is 'Untitled document' (§8.11 default-quarantine), but CONTENT is a genuine 'Live Coaching Call - Michael' member session. Recommend KEEP. Proposed title disambiguates from G52 with 'session A' — replace with the real call date if known. |
| G52 | Untitled document(1) | **keep** | **Live Coaching Call — Michael (session B)** | Group Coaching / strategic_coach | Title is 'Untitled document(1)' (§8.11 default-quarantine), but CONTENT is a 'Live Coaching Call - Michael' member session. Recommend KEEP. Distinct session from G51 (members Ann & Jamie here); proposed title uses 'session B' — replace with the real call date if known. |
| G59 | Zoom Meeting | **keep** | **1-on-1 VA Setup Call — Mikha (member Brenda)** | 1-on-1 VA / va | Title is generic 'Zoom Meeting' (§8.11 default-quarantine / John-Dela-Cruz Zoom-Meeting suspect), but CONTENT is a VA (Mikha) 1:1 helping member Brenda set up her first campaign. Recommend KEEP. |

## Suggested EXCLUDE — internal / non-member (12)

Surfaced, never silently dropped. Whole-phrase matching ("check-in", "personal meeting
room") plus content confirmation. Quarantine blocks both citation **and** mining.

| Group | Title | Doc ids | Summary | Reason |
|---|---|---|---|---|
| G6 | E-Comm Weekly Check in | 425, 426, 427, 428, 429 | Internal e-commerce ops team meeting (Mona Palad, Gene/Build Test Scale; Tagalog staff chatter, 2025 Shopify order sheet, customer-service status). Not member-facing. | Internal staff e-commerce check-in — no member present; staffing/ops content. |
| G7 | E-Comm Weekly Check In(1) | 420, 421, 422, 423, 424 | Internal e-commerce ops meeting with Mark Blyn, Mona and Gene reviewing email/chat turnaround, hiring, weekend chatter. Staff-only. | Internal staff e-commerce check-in (whole-phrase 'check in'); no member. |
| G8 | E-Comm Weekly Check-in | 430, 431, 432, 433 | Internal e-commerce ops meeting (Mark Blyn, Mona, Gene) reviewing Shopify theme plugins and what they pay for. Staff-only. | Internal staff e-commerce check-in; no member. |
| G18 ⚑ | John Freese _ Mark Blyn | 454, 455, 456, 457, 458 | Member John Freese meets CEO Mark Blyn and COO Jean about feeling behind, cash-flow and program-timing concerns. Executive relationship/retention call, not instructional coaching. | Executive/member relationship call with business-internal discussion; low KB-training value. |
| G46 | Mark Blyn_s Personal Meeting Room | 592, 593, 594, 595, 596 | Internal leadership meeting in Mark Blyn's personal Zoom room (Ash Ali 'Senior Advisor', George Wilson, Coach Beau) weighing contract options A vs B. Business/staffing, not member-facing. | Internal leadership/business meeting (personal meeting room); contract/staffing discussion. |
| G47 ⚑ | TCE Concierge Coaching Weekly | 597, 598, 599, 600, 601 | Internal staff meeting (Jean/COO, Neil, Aliena, Mark Blyn) about VAs supporting the coaches' calls and handling technical chat. Staff coordination. | Internal concierge/support staff coordination meeting; no member. |
| G48 ⚑ | TCE SUPPORT COACHING WEEKLY | 607, 608, 609, 610, 611 | Internal support-team meeting (Gene, support staff, Veronica) about onboarding a new team member and what training video to share. Staff-only. | Internal support-coaching weekly staff meeting; no member. |
| G49 ⚑ | TCE SUPPORT COACHING WEEKLY(1) | 602, 603, 604, 605, 606 | Internal support-team meeting (Sandy, Gene) about consolidating the weekly check-in with the concierge team and WordPress/integration skills. Staff-only. | Internal support-coaching weekly staff meeting; no member. |
| G50 ⚑ | TCE Support Coaching Weekly(2) | 612, 613, 614, 615, 616 | Internal support-team meeting (Gene, Sandy, Kei) about Slack workload and handing off a support conversation. Staff-only. | Internal support-coaching weekly staff meeting; no member. |
| G53 | WEEKLY COACHES CHECK IN | 627, 628, 629, 630, 631 | Internal coaches' check-in (Gene/Build Test Scale with coach Sasha) on coach training/alignment and expected cost-per-add-to-cart math across networks. Staff-only. | Internal weekly coaches check-in (whole-phrase); coach+staff, no member. |
| G54 | Weekly Coaches Check In(1) | 632, 633, 634, 635, 636 | Internal coaches' check-in (Sandy, Mona, Gene, Sasha) on support workload, response-time expectations and chat UX. Staff-only. | Internal weekly coaches check-in; staff, no member. |
| G55 | Weekly Coaches Check- In | 637, 638, 639, 640, 641 | Internal coaches' check-in (Gene, Mona, Sasha, Mark) on payout/Tipalti processing delays and realistic schedule expectations. Staff-only. | Internal weekly coaches check-in; staff, no member. |

## Keepers by folder

### Group Coaching (29)

| Group | Original title | Proposed clean title | Parts (ordered ids) | Role | Coach/VA | Dup-drop ids | Summary |
|---|---|---|---|---|---|---|---|
| G19 | Live Coaching Call | Live Coaching Call | 587, 588, 589, 590, 591 | strategic_coach | Sasha | — | Group LIVE Coaching Call (Sasha) with members Clayton, Patrick et al: ClickBank/Caterpillar post-back integration issue and reviewing a member's ad creatives/headlines. |
| G20 | Live Coaching Call - Bruce | Live Coaching Call - Bruce | 507, 508, 509, 510, 511 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce): announces support staff now on calls; coaches members on not testing too many variables at once; images vs headlines. |
| G21 | LIVE COACHING CALL - BRUCE(1) | LIVE COACHING CALL - BRUCE(1) | 459, 460, 461, 462, 463 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce): fields member confusion about the 21-day Blitz vs the metric-mover 25-landing-page step; support-vs-coach Q&A. |
| G22 | Live Coaching Call - Bruce(2) | Live Coaching Call - Bruce(2) | 492, 493, 494, 495, 496 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce): reviews members' early tests (e.g. Jenn's overspent test); advises keeping 16x9 format and adding images to test against headlines. |
| G23 | Live Coaching Call - Bruce(3) | Live Coaching Call - Bruce(3) | 497, 498, 499, 500, 501 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce): reviews member ad results (cheaper clicks after removing holiday angle); creative-comparison coaching. |
| G24 | Live Coaching Call - Bruce(4) | Live Coaching Call - Bruce(4) | 502, 503, 504, 505, 506 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce): Erin and David review headline tests and cost-per-click results; practical creative/testing guidance. |
| G25 | LIVE COACHING CALL - BRUCE(5) | LIVE COACHING CALL - BRUCE(5) | 464, 465, 466, 467, 468 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce): metric-mover discussion and a member rebuilding a campaign from scratch wanting it reviewed before going live. |
| G26 | Live Coaching Call - Michael | Live Coaching Call - Michael | 517, 518, 519, 520, 521 | strategic_coach | Michael | — | LIVE Coaching Call slot (Michael) with light attendance; Michael coaches on a Lyra-light campaign (compliance on armpit imagery) that is performing well. |
| G27 | Live Coaching Call - Michael | Live Coaching Call - Michael | 522, 523, 524, 525, 526 | strategic_coach | Michael | — | LIVE Coaching Call slot (Michael), effectively 1:1 with member Jem: account/name lookup help and watching others' campaigns to learn. |
| G28 | LIVE COACHING CALL - MICHAEL(1) | LIVE COACHING CALL - MICHAEL(1) | 469, 470, 471 | strategic_coach | Michael | — | LIVE Coaching Call slot (Michael) with no takers; Michael and support discuss falling attendance on his coaching/LaunchPad calls. |
| G29 | Live Coaching Call - Michael(1) | Live Coaching Call - Michael(1) | 45558, 45631, 45639, 45644, 45649 | strategic_coach | Michael | 512, 513, 514, 515, 516 | LIVE Coaching Call slot (Michael) with Aliena support, low attendance; small talk about attendance patterns then campaign help. |
| G30 | LIVE COACHING CALL - MICHAEL(2) | LIVE COACHING CALL - MICHAEL(2) | 472, 473, 474, 475, 476 | strategic_coach | Michael | — | LIVE Coaching Call (Michael) with newer member Kevin: explains the 5x5 metric-mover structure (25 landing pages = 5 headlines × 5 hero shots). |
| G31 | LIVE COACHING CALL - MICHAEL(3) | LIVE COACHING CALL - MICHAEL(3) | 477, 478, 479, 480, 481 | strategic_coach | Michael | — | LIVE Coaching Call slot (Michael), 1:1 with member Linda doing her first round of testing; reading statistics and search/verbiage on landing pages. |
| G32 | Live Coaching Call - Sasha | Live Coaching Call - Sasha | 527, 528, 529, 530, 531 | strategic_coach | Sasha | — | Group LIVE Coaching Call (Sasha) with Karen and Patrick: affiliate-CMO tooling, ad-rejection handling and using plain images on jump pages. |
| G33 | Live Coaching Call - Sasha | Live Coaching Call - Sasha | 542, 543, 544, 545, 546 | strategic_coach | Sasha | — | Group LIVE Coaching Call (Sasha) with Patrick: a stuck/over-budget first-round test and testing multiple static images on ads. |
| G34 | Live Coaching Call - Sasha(1) | Live Coaching Call - Sasha(1) | 532, 533, 534, 535, 536 | strategic_coach | Sasha | — | LIVE Coaching Call (Sasha), 1:1 with new member Karen: intro to support-on-calls, and whether to have someone produce 5 headlines / 5 hero shots for you. |
| G35 | LIVE COACHING CALL - SASHA(2) | LIVE COACHING CALL - SASHA(2) | 482, 483, 484, 485, 486 | strategic_coach | Sasha | — | Group LIVE Coaching Call (Sasha) with Jenn: diagnosing a 'flop' campaign; headline phrasing (curiosity vs misleading) and pre-framing. |
| G36 | LIVE COACHING CALL - SASHA(3) | LIVE COACHING CALL - SASHA(3) | 487, 488, 489, 490, 491 | strategic_coach | Sasha | — | Group LIVE Coaching Call (Sasha) with Guy and Patrick: reading round-2.1 test data and spotting clear breakaway winners across placements. |
| G37 | Live Coaching Call - Sasha(4) | Live Coaching Call - Sasha(4) | 537, 538, 539, 540, 541 | strategic_coach | Sasha | — | LIVE Coaching Call (Sasha) with new/overwhelmed member Mozelle: encourages focusing on one campaign at a time when starting out. |
| G38 | Live Coaching Call - Todd | Live Coaching Call - Todd | 552, 553, 554, 555, 556 | strategic_coach | Todd | — | Group LIVE Coaching Call (Todd): announces support team on calls; reviews member Aaron's improving cost-per-click and landing-page CTR numbers. |
| G39 | Live Coaching Call - Todd(1) | Live Coaching Call - Todd(1) | 547, 548, 549, 550, 551 | strategic_coach | Todd | — | Group LIVE Coaching Call (Todd) with Greg: round-2 testing issues, warning/drop messages and testing affiliate-CMO headline pushes. |
| G40 | Live Coaching Call- Bruce | Live Coaching Call- Bruce | 577, 578, 579, 580, 581 | strategic_coach | Bruce | — | LIVE Coaching Call (Bruce), holiday session with John Blackwell and Mozelle: before/after hero imagery and active-dog creative ideas. |
| G41 | Live Coaching Call- Michael | Live Coaching Call- Michael | 45799, 45806, 45812, 45817, 45839 | strategic_coach | Michael | 582, 583, 584, 585, 586 | LIVE Coaching Call slot (Michael), 1:1 with member Linda: debugging an oddball stats anomaly across empty campaigns during first-round testing. |
| G42 | Live Coaching Call(1) | Live Coaching Call(1) | 557, 558, 559, 560, 561 | strategic_coach | Bruce | — | Group LIVE Coaching Call (Bruce) with Eddy and others: reviewing an advertorial hero image (wrinkles/under-eye) and whether it needs changing. |
| G43 | Live Coaching Call(2) | Live Coaching Call(2) | 562, 563, 564, 565, 566 | strategic_coach | Todd | — | Group LIVE Coaching Call (Todd) with Paul Carr: post round-2 next steps and minimizing variables (e.g. all-landscape-GIF ad sets) when isolating the winner. |
| G44 | Live Coaching Call(3) | Live Coaching Call(3) | 567, 568, 569, 570, 571 | strategic_coach | Michael | — | Group LIVE Coaching Call (Michael) with Brent, Jenn, Scott: judging whether a headline is a winner via the 'would I click?' exercise. |
| G45 | Live Coaching Call(4) | Live Coaching Call(4) | 572, 573, 574, 575, 576 | strategic_coach | Todd | — | Group LIVE Coaching Call (Todd), small holiday group: character limits on ads vs unrestricted landing-page headlines. |
| G51 ⚑ | Untitled document | **Live Coaching Call — Michael (session A)** | 622, 623, 624, 625, 626 | strategic_coach | Michael | — | Mistitled 'Untitled document' — actually a LIVE Coaching Call (Michael) with member Fauuex: New-Year greetings then Zoom screen-share help during coaching. |
| G52 ⚑ | Untitled document(1) | **Live Coaching Call — Michael (session B)** | 617, 618, 619, 620, 621 | strategic_coach | Michael | — | Mistitled 'Untitled document' — actually a LIVE Coaching Call (Michael) with members Ann and Jamie: attendance patterns then reading ads/landing-page angles and headlines. |

### Private Coaching (3)

| Group | Original title | Proposed clean title | Parts (ordered ids) | Role | Coach/VA | Dup-drop ids | Summary |
|---|---|---|---|---|---|---|---|
| G1 ⚑ | Adam Field Meeting Information | **Private Coaching — Adam Field (Coach Sasha)** | 392, 393, 394, 395, 396 | strategic_coach | Sasha | — | 1:1 call: coach Sasha reviews member Adam Field's first-round headline test (10 headlines, variation 5 strongest) and advises testing images next. Pure campaign-optimization coaching despite the generic 'Meeting Information' Zoom title. |
| G2 | Cheryl L Rodriguez | Cheryl L Rodriguez | 397, 398, 399, 400, 401 | strategic_coach | Bruce | — | 1:1 call: coach Bruce works through member Cheryl Rodriguez's ad imagery and headline strategy for a Berkshire product, stressing attention-grabbing imagery over familiar stock. |
| G3 ⚑ | Dara Dameron Meeting Information | **Private Coaching — Dara Dameron (Coach Sasha)** | 407, 408, 409, 410, 411 | strategic_coach | Sasha | 402, 403, 404, 405, 406 | 1:1 call: coach Sasha teaches member Dara Dameron (nursing background) how to read DIY Trax stats for her Skin Spectra / Media Mavens round-2 test and the pitfall of spawning a new sub-campaign. |

### 1-on-1 VA (7)

| Group | Original title | Proposed clean title | Parts (ordered ids) | Role | Coach/VA | Dup-drop ids | Summary |
|---|---|---|---|---|---|---|---|
| G4 | Donald Hayes - Mitolyn | Donald Hayes - Mitolyn | 47195, 47196, 47197, 47198, 47199 | va | Aliena | 415, 416, 417, 418, 419 | 1:1 VA call: Aliena (support) helps member Don Hayes set up/troubleshoot his Mitolyn campaign in DIY Trax (folders, refresh, campaign placement) plus payment/coach-access issues. |
| G5 | Donald Hayes - Mitolyn(1) | Donald Hayes - Mitolyn(1) | 47192, 47193, 47194 | va | Aliena | 412, 413, 414 | 1:1 VA call (shorter follow-up): Aliena walks member Don Hayes through integrating his Mitolyn landing-page content into DIY Trax one item at a time. |
| G9 | Fauuex Daniel - help | Fauuex Daniel - help | 434, 435, 436, 437, 438 | va | John | — | 1:1 VA call: John Dela Cruz helps member Fauuex Daniel review a prior campaign and navigate Zoom/DIY Trax (toggle campaign, check earlier dates). |
| G10 | Gayle Pratt - coping the 25 pages to diy tra | Gayle Pratt - coping the 25 pages to diy tra | 47219, 47220, 47221, 47222, 47223 | va | Neil | 439, 440, 441, 442, 443 | 1:1 VA call: Neil Warren helps member Gayle Pratt copy her 25 Media Mavens landing pages into DIY Trax and explains how the 5 headline × 5 hero-shot variations are verified. |
| G16 | Jack Gambardella - Caterpillar | Jack Gambardella - Caterpillar | 47224, 47225, 47226, 47227, 47228 | va | Neil | 444, 445, 446, 447, 448 | 1:1 VA call: Neil Warren guides member Jack Gambardella (first product build phase) through creating his DIY Trax campaign and assembling ad/landing-page materials on Caterpillar. |
| G17 | Jeff Gehman - go live for round 2 testing | Jeff Gehman - go live for round 2 testing | 47229, 47230, 47231, 47232, 47233 | va | Aliena | 449, 450, 451, 452, 453 | 1:1 VA call: Aliena helps member Jeff Gehman go live for round-2 testing after compliance approval; much of the call is Zoom screen-share troubleshooting. |
| G59 ⚑ | Zoom Meeting | **1-on-1 VA Setup Call — Mikha (member Brenda)** | 642, 643, 644, 645 | va | Mikha | — | Mistitled 'Zoom Meeting' — actually a 1:1 VA call: Mikha helps returning member Brenda set up her first campaign and replace a duplicate hero shot / landing-page asset. |

### Blitz Video (26)

| Group | Original title | Proposed clean title | Parts (ordered ids) | Role | Coach/VA | Dup-drop ids | Summary |
|---|---|---|---|---|---|---|---|
| G60 | 1 - Overview of Affiliate Arbitrage Process (1) | 1 - Overview of Affiliate Arbitrage Process (1) | 174, 175 | curriculum | — | — | Intro lesson: what affiliate arbitrage is and the BTS method — run ads, send clicks to a landing/bridge/jump page, then to a VSL/offer. |
| G61 | 2 - Choose Your Offer Network (1) | 2 - Choose Your Offer Network (1) | 176, 177 | curriculum | — | — | Lesson: how to choose your offer network in the portal — Media Mavens (internal) vs ClickBank. |
| G62 | 3 - Logging Into Media Mavens For The First Time (1) | 3 - Logging Into Media Mavens For The First Time (1) | 178 | curriculum | — | — | Lesson: first-time Media Mavens login and account setup from the portal. |
| G63 | 4 - Choosing Your Media Mavens Product To Promote (1) | 4 - Choosing Your Media Mavens Product To Promote (1) | 179 | curriculum | — | — | Lesson: browsing Media Mavens to choose an offer, viewing commission/consumer price, and grabbing the affiliate link. |
| G64 | 5 - How To Get Your Media Mavens Offer Affiliate Link (1) | 5 - How To Get Your Media Mavens Offer Affiliate Link (1) | 180 | curriculum | — | — | Lesson: retrieving your Media Mavens affiliate link and understanding the ref code per product. |
| G65 | 6 - Choosing Your ClickBank Product To Promote (1) | 6 - Choosing Your ClickBank Product To Promote (1) | 181, 182 | curriculum | — | — | Lesson: finding and selecting a top ClickBank offer (Affiliate Marketplace, CBSnooper stats) — technical how-to. |
| G66 | 7 pillars new | 7 pillars new | 183, 184 | curriculum | — | — | Founder intro training ('7 pillars'): BTS philosophy, profitable niches (trendy gadgets, health & wellness) and audience focus. |
| G68 | Blitz - Ad Banner Edge | Blitz - Ad Banner Edge | 196, 197, 198 | curriculum | — | — | Blitz training on ad-banner strategy: ads are the most-seen funnel element and need the most testing to fight fatigue; advertorial hook examples. |
| G69 | BTS Blitz - Caterpillar RD2 vid 1 cropbot 9x16 image 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 1 cropbot 9x16 image 2025-10-21 | 314 | curriculum | — | — | Blitz Caterpillar round-2 (vid 1): create the five placement formats (16x9, 9x16, GIFs) from your round-1 static image. |
| G70 | BTS Blitz - Caterpillar RD2 vid 2 grok imagine vids 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 2 grok imagine vids 2025-10-21 | 315, 316 | curriculum | — | — | Blitz Caterpillar round-2 (vid 2): turn static ad images into videos using Grok Imagine. |
| G71 | BTS Blitz - Caterpillar RD2 vid 3 trim vids adobe express 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 3 trim vids adobe express 2025-10-21 | 317, 318 | curriculum | — | — | Blitz Caterpillar round-2 (vid 3): trim Grok video clips in Adobe Express before converting to GIFs. |
| G72 | BTS Blitz - Caterpillar RD2 vid 4 vids to GIF adobe express 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 4 vids to GIF adobe express 2025-10-21 | 319 | curriculum | — | — | Blitz Caterpillar round-2 (vid 4): convert trimmed videos to GIFs using Adobe Express. |
| G73 | BTS Blitz - Caterpillar RD2 vid 5 reduce GIF GIFSTER 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 5 reduce GIF GIFSTER 2025-10-21 | 320 | curriculum | — | — | Blitz Caterpillar round-2 (vid 5): reduce GIF file size under the 5MB limit using Gifster (frame-delay trick). |
| G74 | BTS Blitz - Caterpillar RD2 vid 6 vids to GIF GIFSTER 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 6 vids to GIF GIFSTER 2025-10-21 | 321, 322 | curriculum | — | — | Blitz Caterpillar round-2 (vid 6): turn videos into GIFs using the proprietary Gifster app. |
| G75 | BTS Blitz - Caterpillar RD2 vid 7 launch rd 2 ads 2025-10-21 | BTS Blitz - Caterpillar RD2 vid 7 launch rd 2 ads 2025-10-21 | 323, 324, 325 | curriculum | — | — | Blitz Caterpillar round-2 (vid 7): launch the round-2 placement test with the winning headline. |
| G76 | BTS Blitz - Native Ads vid 1 Headlines w Claude 2025-10-20 | BTS Blitz - Native Ads vid 1 Headlines w Claude 2025-10-20 | 326, 327, 328, 329 | curriculum | — | — | Blitz Native Ads (vid 1): use Claude to write 90-char headlines/descriptions with Caterpillar dynamic-content macros. |
| G77 | BTS Blitz - Native Ads vid 2 Images w Midjourney 2025-10-20 | BTS Blitz - Native Ads vid 2 Images w Midjourney 2025-10-20 | 330, 331, 332 | curriculum | — | — | Blitz Native Ads (vid 2): generate ad images with AI (MidJourney via Discord). |
| G78 | BTS Blitz - Traffic vid 1 Caterpillar Basic Info 2025-10-20 | BTS Blitz - Traffic vid 1 Caterpillar Basic Info 2025-10-20 | 333 | curriculum | — | — | Blitz Traffic (vid 1): create a new Caterpillar campaign and set the basic info / macro template. |
| G79 | BTS Blitz - Traffic vid 2 Caterpillar Traffic Source 2025-10-20 | BTS Blitz - Traffic vid 2 Caterpillar Traffic Source 2025-10-20 | 334, 335, 336 | curriculum | — | — | Blitz Traffic (vid 2): configure Caterpillar traffic-source settings, products, and testing-budget math. |
| G80 | BTS Blitz - Traffic vid 3 Caterpillar First Ad 2025-10-20 | BTS Blitz - Traffic vid 3 Caterpillar First Ad 2025-10-20 | 337, 338 | curriculum | — | — | Blitz Traffic (vid 3): create your first native ad in the Caterpillar campaign. |
| G81 | BTS Blitz - Traffic vid 4 Caterpillar More Ads 2025-10-20 | BTS Blitz - Traffic vid 4 Caterpillar More Ads 2025-10-20 | 339 | curriculum | — | — | Blitz Traffic (vid 4): create additional ads by duplicating the first (same image/description, vary headlines). |
| G82 | BTS Blitz - Traffic vid 5 Caterpillar Landing Pages 2025-10-20 | BTS Blitz - Traffic vid 5 Caterpillar Landing Pages 2025-10-20 | 340 | curriculum | — | — | Blitz Traffic (vid 5): add landing pages to the campaign (with a pointer to the MetricMover split-test videos). |
| G83 | BTS Blitz - Traffic vid 6 Caterpillar Offer Page Link 2025-10-20 | BTS Blitz - Traffic vid 6 Caterpillar Offer Page Link 2025-10-20 | 341 | curriculum | — | — | Blitz Traffic (vid 6): add your affiliate offer link (ref code) in the Caterpillar offer-pages tab. |
| G84 | BTS Blitz - Traffic vid 8 Caterpillar Final QA 2025-10-20 | BTS Blitz - Traffic vid 8 Caterpillar Final QA 2025-10-20 | 342, 343, 344 | curriculum | — | — | Blitz Traffic (vid 8): final QA campaign check (naming, URL append tokens, DIY Trax links) before going live. |
| G109 | Copy Blocks Training 2 | Copy Blocks Training 2 | 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251 | curriculum | — | — | Coach training on the 'copy blocks' concept for landing-page/advertorial copy (long session, expanded from a prior call). |
| G128 | Hero Shots CB Training | Hero Shots CB Training | 185, 186, 187, 188, 189, 190, 191, 192, 193 | curriculum | — | — | Coach training on hero shots for ClickBank: what a hero shot is, sizing/aspect ratio, and uploading in Flexy (long session). |

### Other Video (71)

| Group | Original title | Proposed clean title | Parts (ordered ids) | Role | Coach/VA | Dup-drop ids | Summary |
|---|---|---|---|---|---|---|---|
| G67 | Add Domain To Flexy | Add Domain To Flexy | 194, 195 | curriculum | — | — | Tool how-to: adding a custom subdomain/domain to a Flexy account and connecting it to a funnel/website. |
| G85 | BTS Concierge | BTS Concierge | 345 | curriculum | — | — | Promotional intro video to the BTS Concierge service — what it is and that 1-on-1 Zoom calls are included for members. |
| G87 | CB LP - Generating Landing Page Angles Using POE | CB LP - Generating Landing Page Angles Using POE | 199, 200, 201, 202, 203, 204, 205, 206 | curriculum | — | — | Training: generating ClickBank landing-page angles with the POE 'affiliate angle architect' bot (long multi-part session). |
| G88 | CB LP - How to Use the Affiliate Architect Bot | CB LP - How to Use the Affiliate Architect Bot | 207 | curriculum | — | — | Training: how to use the affiliate angle architect bot in POE to get 12 marketing angles for a ClickBank offer. |
| G89 | CB LP - How to Use the Bridge Page Bot | CB LP - How to Use the Bridge Page Bot | 208, 209, 210 | curriculum | — | — | Training: using the bridge-page bot (POE) to turn an angle + VSL transcript into a bridge/jump page. |
| G90 | CB LP - How to Use the Bridge Page Copy Bot | CB LP - How to Use the Bridge Page Copy Bot | 211, 212 | curriculum | — | — | Training: using the bridge-page copy bot (POE) to write jump-page copy from the chosen angle. |
| G91 | CB LP 1 - Install Video DownloadHelper | CB LP 1 - Install Video DownloadHelper | 213, 214 | curriculum | — | — | Training (CB LP 1): install the Video DownloadHelper add-on in Firefox to download ClickBank VSLs. |
| G92 | CB LP 2 - How to Download Your VSL | CB LP 2 - How to Download Your VSL | 215 | curriculum | — | — | Training (CB LP 2): how to find and download the main VSL video for your ClickBank product. |
| G93 | CB LP 3 - How to Get a Transcript of Your VSL Video with Temi | CB LP 3 - How to Get a Transcript of Your VSL Video with Temi | 216, 217, 218 | curriculum | — | — | Training (CB LP 3): transcribe your VSL with Temi and clean up the transcript. |
| G94 | CB LP Choose Jump Page Base to Clone | CB LP Choose Jump Page Base to Clone | 219 | curriculum | — | — | Training: choosing a Flexy jump-page base to clone for your ClickBank bridge-page copy. |
| G95 | CB LP Create More Jump Pages Clone Base | CB LP Create More Jump Pages Clone Base | 220, 221, 222 | curriculum | — | — | Training: cloning your base jump page to create the other landing-page variants. |
| G96 | CB LP Create Your Landing Page Base Copy | CB LP Create Your Landing Page Base Copy | 223, 224, 225 | curriculum | — | — | Training: editing the cloned base page — swapping in headline/subheadline/hero copy and publishing. |
| G97 | CLICKBANK ONLY - DIYTrax ClickBank IPN Integration | CLICKBANK ONLY - DIYTrax ClickBank IPN Integration | 226 | curriculum | — | — | Training (ClickBank only): connect ClickBank to DIY Trax via the ClickBank IPN so conversions post back. |
| G98 | Clone Flexy Website | Clone Flexy Website | 228 | curriculum | — | — | Training: cloning the template website in Flexy so you have your own site to host landing pages. |
| G99 | Clone Page Into Any Website | Clone Page Into Any Website | 229, 230 | curriculum | — | — | Training: cloning a single page from one Flexy website into any other website in your account. |
| G100 | Cloned Flexy 1 - What You Need for Cloned Flexy Page Test | Cloned Flexy 1 - What You Need for Cloned Flexy Page Test | 231 | curriculum | — | — | Training (Cloned Flexy 1): what assets you need ready before running a cloned-Flexy landing-page split test. |
| G101 | Cloned Flexy 2 - How to Duplicate Your Base Flexy Page | Cloned Flexy 2 - How to Duplicate Your Base Flexy Page | 232 | curriculum | — | — | Training (Cloned Flexy 2): duplicating your base Flexy page to make the first test variant (unique path). |
| G102 | Cloned Flexy 3 - How to Change The Headline and Hero Shot | Cloned Flexy 3 - How to Change The Headline and Hero Shot | 233 | curriculum | — | — | Training (Cloned Flexy 3): changing the headline and hero shot on a page variant. |
| G103 | Cloned Flexy 4 - Further Page Edits | Cloned Flexy 4 - Further Page Edits | 234, 235 | curriculum | — | — | Training (Cloned Flexy 4): further variant edits — swapping gendered pronouns/names for continuity with the hero. |
| G104 | Cloned Flexy 5 - Cloning and Editing More Landing Page Variants | Cloned Flexy 5 - Cloning and Editing More Landing Page Variants | 236 | curriculum | — | — | Training (Cloned Flexy 5): strategically cloning and editing additional landing-page variants. |
| G105 | Cloned Flexy 6 - Gathering Your Landing Page Variant URLs for Use In DIYTrax | Cloned Flexy 6 - Gathering Your Landing Page Variant URLs for Use In DIYTrax | 237 | curriculum | — | — | Training (Cloned Flexy 6): gathering your landing-page variant URLs into a text file for DIY Trax. |
| G106 | Cloned Flexy 7 - Adding Your Landing Page Variant URLs to Your DIYTrax Campaign | Cloned Flexy 7 - Adding Your Landing Page Variant URLs to Your DIYTrax Campaign | 238 | curriculum | — | — | Training (Cloned Flexy 7): adding your landing-page variant URLs to your DIY Trax campaign. |
| G107 | Cloning Your Advertorial Page | Cloning Your Advertorial Page | 239 | curriculum | — | — | Training: finding and cloning the correct advertorial page for your chosen product in Flexy. |
| G108 | Connect Domain To Website | Connect Domain To Website | 240 | curriculum | — | — | Training: connecting your custom domain/subdomain to your live testing website. |
| G110 | Create DIYTrax Campaign Placeholder | Create DIYTrax Campaign Placeholder | 252, 253 | curriculum | — | — | Training: creating a placeholder DIY Trax campaign and choosing offer type / traffic source / network. |
| G111 | Creating Ad Banner Variants for Testing | Creating Ad Banner Variants for Testing | 254, 255 | curriculum | — | — | Training: setting up ad-banner variants for your first test (three sizes; building back-to-front). |
| G112 | Creating Split Test Variants for Your Advertorial | Creating Split Test Variants for Your Advertorial | 256, 257 | curriculum | — | — | Training: gathering split-test variant assets (headlines/hero shots) for your advertorial. |
| G113 | CROPBOT (1) | CROPBOT (1) | 227 | curriculum | — | — | Tool intro: CropBot Chrome extension for cropping/resizing campaign images (part of CropBot/ScrapeBot/PixelPress trio). |
| G114 | DIYTRAX (1) | DIYTRAX (1) | 270 | curriculum | — | — | Tool intro: DIY Trax, the URL/landing-page rotator and tracking tool (stable 2.0). |
| G115 | DIYTrax LP Offer Link in Custom Value | DIYTrax LP Offer Link in Custom Value | 271, 272 | curriculum | — | — | Training: adding your DIY Trax landing-page offer link into Flexy custom values. |
| G116 | DIYTrax LP Offer Link in Landing Page | DIYTrax LP Offer Link in Landing Page | 273, 274 | curriculum | — | — | Training: verifying the correct DIY Trax T2 offer link is on your landing pages. |
| G117 | DIYTRAX Traffic 1 - Configure Traffic Source Settings | DIYTRAX Traffic 1 - Configure Traffic Source Settings | 258, 259 | curriculum | — | — | Training (DIYTRAX Traffic 1): configure traffic-source settings, budget ($500 min) and the no-touch spend rule. |
| G118 | DIYTRAX Traffic 2 - Upload Ad Banners | DIYTRAX Traffic 2 - Upload Ad Banners | 260 | curriculum | — | — | Training (DIYTRAX Traffic 2): upload your ad banners (size limits, multiple banner sizes). |
| G119 | DIYTRAX Traffic 3 - Fund Your Traffic Source | DIYTRAX Traffic 3 - Fund Your Traffic Source | 261, 262 | curriculum | — | — | Training (DIYTRAX Traffic 3): fund your traffic source (min ~$1,500 for first round). |
| G120 | DIYTRAX Traffic 4 - Place Affiliate Link in DIYTrax Campaign Offer Pages | DIYTRAX Traffic 4 - Place Affiliate Link in DIYTrax Campaign Offer Pages | 263 | curriculum | — | — | Training (DIYTRAX Traffic 4): place your affiliate offer link in the DIY Trax campaign offer pages. |
| G121 | DIYTRAX Traffic 5 - Perform a Final QA Campaign Check | DIYTRAX Traffic 5 - Perform a Final QA Campaign Check | 264, 265 | curriculum | — | — | Training (DIYTRAX Traffic 5): perform a final QA safety check (append token, landing pages, links) before launch. |
| G122 | DIYTRAX Traffic 6 - Submit Ad Banners and Turn Campaign Toggle to Active | DIYTRAX Traffic 6 - Submit Ad Banners and Turn Campaign Toggle to Active | 266 | curriculum | — | — | Training (DIYTRAX Traffic 6): submit ad banners and turn the campaign toggle to active (CPC bid). |
| G123 | DIYTRAX Traffic 7 - How Grasshopper Traffic Source Works and What to Expect | DIYTRAX Traffic 7 - How Grasshopper Traffic Source Works and What to Expect | 267, 268, 269 | curriculum | — | — | Training (DIYTRAX Traffic 7): how the Grasshopper traffic source ramps and what to expect early; reading banner performance. |
| G124 | Flexy (1) | Flexy (1) | 275 | curriculum | — | — | Tool intro: Flexy drag-and-drop landing-page/website builder. |
| G125 | Generate Advertorial Headlines with AffiliateCMO | Generate Advertorial Headlines with AffiliateCMO | 276, 277, 278, 279 | curriculum | — | — | Training: generating advertorial headlines with the Affiliate CMO AI copywriting tool. |
| G126 | Generate Advertorial Headlines with FreeAdCopy | Generate Advertorial Headlines with FreeAdCopy | 280, 281 | curriculum | — | — | Training: generating advertorial split-test headlines with the FreeAdCopy.com (Halbert generator) tool. |
| G127 | Gifster (1) | Gifster (1) | 282 | curriculum | — | — | Tool intro: Gifster, the automated animated-GIF creator for ad images. |
| G129 | How to Know Whether to Use Metric Mover or Individual Landing Pages | How to Know Whether to Use Metric Mover or Individual Landing Pages | 283, 284 | curriculum | — | — | Training: deciding whether to use MetricMover vs individually cloned landing pages for a split test. |
| G130 | Landing Page Overview | Landing Page Overview | 285 | curriculum | — | — | Training: landing-page overview and building the funnel back-to-front (Skeeter Strike used only as an example). |
| G131 | Metric Mover (1) | Metric Mover (1) | 299 | curriculum | — | — | Tool intro: MetricMover landing-page split-tester and its DIY Trax integration. |
| G132 | Metric Mover 1 - What You Need for Metric Mover Test | Metric Mover 1 - What You Need for Metric Mover Test | 290 | curriculum | — | — | Training (Metric Mover 1): what resources/assets you need ready to set up a MetricMover test. |
| G133 | Metric Mover 10 - How to Embed Metric Mover Code in Flexy Page | Metric Mover 10 - How to Embed Metric Mover Code in Flexy Page | 286 | curriculum | — | — | Training (Metric Mover 10): embedding the MetricMover page code into your Flexy page. |
| G134 | Metric Mover 11 - How to Check Metric Mover Page Variants | Metric Mover 11 - How to Check Metric Mover Page Variants | 287 | curriculum | — | — | Training (Metric Mover 11): checking your MetricMover page variants in the browser. |
| G135 | Metric Mover 12 - How to Find Metric Mover File for DIYTrax Import | Metric Mover 12 - How to Find Metric Mover File for DIYTrax Import | 288 | curriculum | — | — | Training (Metric Mover 12): locating the trax-import CSV for DIY Trax. |
| G136 | Metric Mover 13 - How to Import Metric Mover Page Variants to DIYTrax | Metric Mover 13 - How to Import Metric Mover Page Variants to DIYTrax | 289 | curriculum | — | — | Training (Metric Mover 13): importing MetricMover landing-page variants into your DIY Trax campaign. |
| G137 | Metric Mover 2 - Creating a New Metric Mover Campaign | Metric Mover 2 - Creating a New Metric Mover Campaign | 291 | curriculum | — | — | Training (Metric Mover 2): creating a new MetricMover project/folder. |
| G138 | Metric Mover 3 - How to Import Your Landing Page into Metric Mover | Metric Mover 3 - How to Import Your Landing Page into Metric Mover | 292 | curriculum | — | — | Training (Metric Mover 3): importing your base landing page into MetricMover. |
| G139 | Metric Mover 4 - How to Create Headline Variants in Metric Mover | Metric Mover 4 - How to Create Headline Variants in Metric Mover | 293 | curriculum | — | — | Training (Metric Mover 4): creating headline variants in MetricMover (tag variations). |
| G140 | Metric Mover 5 - How to Upload Hero Shots to Flexy for Use in Metric Mover | Metric Mover 5 - How to Upload Hero Shots to Flexy for Use in Metric Mover | 294 | curriculum | — | — | Training (Metric Mover 5): uploading hero shots to Flexy for use in MetricMover. |
| G141 | Metric Mover 6 - How to Create Hero Shot Variants in Metric Mover | Metric Mover 6 - How to Create Hero Shot Variants in Metric Mover | 295 | curriculum | — | — | Training (Metric Mover 6): creating hero-shot variants in MetricMover. |
| G142 | Metric Mover 7 - How to Set Up Flexy Page for Metric Mover Code | Metric Mover 7 - How to Set Up Flexy Page for Metric Mover Code | 296 | curriculum | — | — | Training (Metric Mover 7): setting up the Flexy base page that will hold the MetricMover code. |
| G143 | Metric Mover 8 - How to Export Metric Mover Campaign Files | Metric Mover 8 - How to Export Metric Mover Campaign Files | 297 | curriculum | — | — | Training (Metric Mover 8): generating/exporting the MetricMover Flexy-page code. |
| G144 | Metric Mover 9 - How to Find Metric Mover Code File | Metric Mover 9 - How to Find Metric Mover Code File | 298 | curriculum | — | — | Training (Metric Mover 9): finding the exported MetricMover code file in the zip. |
| G145 | Optimize Landing Page Base Copy | Optimize Landing Page Base Copy | 300, 301, 302, 303 | curriculum | — | — | Training: optimizing your landing-page base copy (links, mobile layout, fonts) before cloning variants. |
| G146 | p and l tracker | p and l tracker | 346, 347, 348 | curriculum | — | — | Tool how-to: using the P&L (profit & loss) tracker spreadsheet to log daily media-buy numbers. |
| G147 | Pixel Press (1) | Pixel Press (1) | 304 | curriculum | — | — | Tool intro: PixelPress bulk banner-ad creator. |
| G148 | ROUND 1 - What To Do If Campaign and Banners Turn Off Before 1500 Spend | ROUND 1 - What To Do If Campaign and Banners Turn Off Before 1500 Spend | 305, 306 | curriculum | — | — | Training (ROUND 1): what to do if your campaign/banners turn off before reaching $1,500 spend (reactivate). |
| G149 | ROUND 1 - When to Make a Banner Inactive | ROUND 1 - When to Make a Banner Inactive | 307 | curriculum | — | — | Training (ROUND 1): when/why to set a banner inactive in DIY Trax (LP event CTR, spend thresholds). |
| G150 | Scrape Bot (1) | Scrape Bot (1) | 308 | curriculum | — | — | Tool intro: ScrapeBot Chrome extension for sourcing campaign images from search engines. |
| G151 | Submit Ad Banner Split Test Media to Compliance | Submit Ad Banner Split Test Media to Compliance | 309, 310 | curriculum | — | — | Training: submitting ad-banner split-test media to compliance (don't send every variant). |
| G152 | Submit Advertorial Split Test Media to Compliance | Submit Advertorial Split Test Media to Compliance | 311, 312, 313 | curriculum | — | — | Training: submitting advertorial/landing-page split-test media to compliance for review. |
| G153 | tips and tricks - nano banana | tips and tricks - nano banana | 349, 350, 351 | curriculum | — | — | Weekly tip: using Nano Banana (Google AI Studio / Gemini image editor) to make/resize ad creatives for Caterpillar. |
| G154 | tips and tricks 1 - grok imagine | tips and tricks 1 - grok imagine | 352 | curriculum | — | — | Weekly tip: using Grok Imagine to turn a static image into a video/animated GIF for landing pages. |
| G155 | tips and tricks 2 - anstrex native ad copy | tips and tricks 2 - anstrex native ad copy | 353, 354 | curriculum | — | — | Weekly tip: writing native-ad copy using Anstrex (spy tool) plus Claude. |
| G156 | tips and tricks 3 - headlines in a specific style | tips and tricks 3 - headlines in a specific style | 355, 356 | curriculum | — | — | Weekly tip (9-19-2025): generating headlines in a specific style with Claude using the Creative Drive copywriting docs. |
| G157 | tips and tricks 4 (1) | tips and tricks 4 (1) | 357, 358 | curriculum | — | — | Weekly tip (9-26-2025): optimizing a working Caterpillar campaign creatively (e.g. editing a dog video with AI). |

### Reference Docs (13)

| Group | Original title | Proposed clean title | Parts (ordered ids) | Role | Coach/VA | Dup-drop ids | Summary |
|---|---|---|---|---|---|---|---|
| G11 | How can I get a recording of my Kick-Off Call? | How can I get a recording of my Kick-Off Call? | 362 | curriculum | — | — | Support FAQ article (not a transcript): how to request a recording of your Kick-Off Call via support chat/email. |
| G12 | How do I book a session with the BTS Concierge Team? | How do I book a session with the BTS Concierge Team? | 365 | curriculum | — | — | Support FAQ article: how to book a session with the BTS Concierge Team (booking link, one-at-a-time rule, what they assist with). |
| G13 | How do I book my Kick-Off Call? | How do I book my Kick-Off Call? | 361 | curriculum | — | — | Support FAQ article: how to book your 60-minute Kick-Off onboarding call (scheduling link, what to expect). |
| G14 | How do I book my LaunchPad onboarding call? | How do I book my LaunchPad onboarding call? | 380 | curriculum | — | — | Support FAQ article: how to book your LaunchPad onboarding call (scheduling link, what to expect). |
| G15 | I missed my LaunchPad onboarding call - what should I do? | I missed my LaunchPad onboarding call - what should I do? | 381 | curriculum | — | — | Support FAQ article: what to do if you missed your LaunchPad onboarding call (rescheduling options). |
| G56 | When are the live Q&A coaching calls? | When are the live Q&A coaching calls? | 364 | curriculum | — | — | Support FAQ article: live Q&A coaching calls run 6 days/week; where to view the schedule and the benefits of attending. |
| G57 | When are the Thursday Live Coaching Calls? | When are the Thursday Live Coaching Calls? | 383 | curriculum | — | — | Support FAQ article: LaunchPad Thursday live coaching calls (3pm CST, hosted by Michael and Todd); how to join and access replays. |
| G58 | Why can't I book a 1-on-1 call with the BTS Concierge? | Why can't I book a 1-on-1 call with the BTS Concierge? | 384 | curriculum | — | — | Support FAQ article: why LaunchPad members can't book a 1-on-1 Concierge call (Mentorship-only) and their alternative support options. |
| G86 | BTS Training Curriculum Overview | BTS Training Curriculum Overview | 575536 | curriculum | — | — | Authored overview doc (not a transcript): the BTS Blitz curriculum = 23 lessons across 4 phases (Intro, Build, Test, Scale) with phase gates. |
| G158 | Training Curriculum: Introduction | Training Curriculum: Introduction | 575549 | curriculum | — | — | Authored curriculum index (not a transcript): the Introduction phase = 2 lessons (What Is Affiliate Arbitrage?, Understand the System). |
| G159 | Training Curriculum: Phase 1 — Build | Training Curriculum: Phase 1 — Build | 575559 | curriculum | — | — | Authored curriculum index: Phase 1 — Build = 12 lessons (network/offer selection, creative assets, compliance, Flexy/DIYTrax/MetricMover setup, go live). |
| G160 | Training Curriculum: Phase 2 — Test | Training Curriculum: Phase 2 — Test | 575574 | curriculum | — | — | Authored curriculum index: Phase 2 — Test = 6 lessons (round 1 headline, round 2 visual, round 3 placement, with between-round prep). |
| G161 | Training Curriculum: Phase 3 — Scale | Training Curriculum: Phase 3 — Scale | 575585 | curriculum | — | — | Authored curriculum index: Phase 3 — Scale = 3 lessons (increase budget on top placement, test new placements/publishers, master publisher). |

## Duplicate drops (appendix)

Full-recording duplicates (re-exported "(1)"/"(2)" copies). Each row below: keep the
canonical part-set, drop the listed redundant ids.

| Group | Title | Keep (canonical) | Drop (duplicate) |
|---|---|---|---|
| G3 | Dara Dameron Meeting Information | 407, 408, 409, 410, 411 | 402, 403, 404, 405, 406 |
| G4 | Donald Hayes - Mitolyn | 47195, 47196, 47197, 47198, 47199 | 415, 416, 417, 418, 419 |
| G5 | Donald Hayes - Mitolyn(1) | 47192, 47193, 47194 | 412, 413, 414 |
| G10 | Gayle Pratt - coping the 25 pages to diy tra | 47219, 47220, 47221, 47222, 47223 | 439, 440, 441, 442, 443 |
| G16 | Jack Gambardella - Caterpillar | 47224, 47225, 47226, 47227, 47228 | 444, 445, 446, 447, 448 |
| G17 | Jeff Gehman - go live for round 2 testing | 47229, 47230, 47231, 47232, 47233 | 449, 450, 451, 452, 453 |
| G29 | Live Coaching Call - Michael(1) | 45558, 45631, 45639, 45644, 45649 | 512, 513, 514, 515, 516 |
| G41 | Live Coaching Call- Michael | 45799, 45806, 45812, 45817, 45839 | 582, 583, 584, 585, 586 |
