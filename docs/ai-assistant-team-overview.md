# BTS AI Assistant — Team Overview: How It Works & Why

*A plain-language explainer for the team. For the full technical design, see the
companion architecture document.*

## In one sentence
We're rebuilding how our AI Chat assistant and AI Voice assistant get their answers — so they
only ever tell members things we've actually checked and approved, organized in a way that's
easy to find and easy to keep up to date.

## The problem we're fixing
Until now, the assistants answered members using raw transcripts of our coaching and training
calls. That sounds reasonable, but those transcripts are full of off-the-cuff remarks,
half-finished thoughts, and even coaches' personal details — and the AI was repeating all of
it to members as if it were official guidance. In one case it surfaced a coach's full name and
personal information it never should have shared.

The deeper issue: roughly **98% of what the AI had to draw from was raw call transcripts**. So
the fix isn't a quick patch to the AI's "rules" — it's fixing what the AI is allowed to learn
from in the first place.

## The big idea
Three simple shifts:
1. **Call recordings become study material, not the official answers.** The AI can learn from
   them, but it can no longer quote them to members.
2. **We write proper, verified answers.** A real person checks and approves every answer
   before a member can see it.
3. **We organize everything by topic** so the right answer is easy to find — and easy to
   update later.

## How the knowledge is organized
Think of it as three shelves:
- **Process** — the step-by-step of building and running a campaign ("how do I do this").
- **Concepts & Skills** — the marketing know-how: angles, headlines, creative strategy
  ("how do I think about this").
- **Operations** — the account side: membership, refunds, call hours, how to get help.

On top of the shelves we add **labels** so things are easy to pull up — e.g. which software a
doc is about (Flexy, DIYTrax…), which concept it relates to, or whether it's a
"something's broken" troubleshooting doc.

**Where the Blitz fits:** the Blitz is a *map laid over the Process shelf* — it shows the
recommended order — but the shelf is organized around the actual work, so if the Blitz changes,
our knowledge doesn't have to be rebuilt.

## The two assistants
- **Chat assistant** → the deep one: software help, strategy, the Blitz, detailed walkthroughs.
- **Voice assistant** → the quick one: account and support questions — membership, refunds,
  call hours.

When a question goes deeper than an assistant should answer, it points the member to the right
place — a live coaching call for strategy, or our support team for account issues. The
assistants know their limits and hand off instead of guessing.

## How we keep answers trustworthy
- **A human approves every member-facing answer** before it goes live.
- We **track which calls each answer came from**, so we can always see the source.
- **Internal team recordings stay internal.** Some recordings are staff meetings, coach
  check-ins, and private rooms that were never meant for members. Those are screened out
  completely — the AI never studies them or quotes them. Anything we can't clearly identify is
  held back until a person clears it.
- **We know who said it — and weigh it accordingly.** Our VAs are the go-to for software and
  setup help; our strategy coaches are the authority on higher-level strategy. The system tags
  where each answer came from, so a VA's off-hand strategy remark never gets treated as official
  strategy — that has to come from (or be confirmed by) a coach first.
- If two calls **disagree**, a person decides the official answer — and we keep the other
  versions on file for context; we don't throw them away.

## What changes, and why it's better
- **Accurate** — members only get checked, approved answers.
- **Safe** — no more accidental leaks of personal or off-hand information.
- **Easy to maintain** — answers live in clear topics, so updating one thing is simple.
- **Future-proof** — if our programs or tools change, the structure holds.

## Where we are
We're rolling this out in ordered steps: first the structure and the "stop quoting
transcripts" fix, then the system for writing verified answers, then filling in the content
topic by topic, and finally tuning how each assistant answers.

## A note on our old platform
A lot of our call recordings happened on our previous platform, which had different names for
things and a different layout. So the AI has to "translate" as it learns: an old name like
"21-day blitz" becomes "the Blitz," and old directions for finding things get updated to where
they live in the new portal. One important detail: the way you get *around the portal* changed,
but the way you use the individual apps (like DIYTrax or Flexy) did not — so we only re-point the
"where do I find it" directions, not the steps inside the apps. Anything the AI isn't sure how to
translate gets flagged for a person to check.

## What happens when the AI doesn't know
Because we're switching the AI off of raw transcripts right away, there will be a stretch where
it simply doesn't have a verified answer for some questions yet. When that happens it won't
guess — it will say it doesn't have a confirmed answer and point the member to the right place (a
coaching call or our support team). We're also writing the most-asked topics first so this window
is as small as possible. We can do this cleanly because we're not live yet — no members are
affected while we build.

## Finding the gaps from real questions
Every time the AI can't confidently answer something, we quietly log the question. That gives us
a running list of what people actually want to know that we haven't covered yet — so we write the
next answers based on real demand instead of guessing. For now this is a simple admin list; we
can make it richer later.

## Keeping it fresh over time
Once we're live, new coaching calls happen every week — and those calls are where new "truths"
and changes to how we operate show up. The same system that builds our answers can be re-run on
those new calls, and it will remind us when an answer is getting old and should be re-checked.
The automatic weekly version of this is a later add-on.

## Who checks the answers
For now, anyone on the admin team can write and approve answers. Money- and policy-related
answers get an extra "look carefully" flag. Later, we may limit approvals to specific people and
require an expert to sign off on the sensitive ones. And if a reviewer runs into two calls that
disagree and genuinely can't tell which is right, they can send it to an expert instead of
guessing.
