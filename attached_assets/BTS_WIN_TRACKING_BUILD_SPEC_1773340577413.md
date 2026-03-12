# BTS Portal — Win Tracking System Build Spec

**Priority:** Post-launch enhancement
**Status:** Not started
**Depends on:** Auth, Community, Entitlement system, Marketing site
**Reference:** New feature (not in original PRD)

---

## Context

Members achieving results is the entire point of BTS. But right now, there's no structured way to capture, verify, celebrate, and leverage those results. Wins get mentioned casually in community posts or coaching calls, then disappear.

This spec builds a dedicated win tracking system that turns member results into a self-reinforcing growth engine: members log wins → wins get celebrated in the portal → admin curates the best into testimonials → testimonials feed the marketing site and VSL funnels → new members see proof → they join → they get wins → the cycle continues.

---

## How It Works

```
MEMBER LOGS A WIN
  → Submits: milestone type, description, proof screenshot, metrics
  → Win appears on their profile and the public Wins Wall

COMMUNITY CELEBRATION
  → Win auto-posted to the Wins category in Community (opt-in)
  → Other members react and comment → social reinforcement
  → Badges awarded for milestone achievements

ADMIN CURATION
  → Admin reviews wins in a curation queue
  → Best wins are promoted to "Featured" status
  → Admin can request a testimonial from the member
  → Approved testimonials are flagged for marketing use

MARKETING PIPELINE
  → Featured wins + approved testimonials are available via API
  → Marketing site pulls them dynamically for the Results page
  → VSL funnels can embed real, verified results
  → Social proof is always fresh and automated
```

---

## What to Build

### 1. Win Milestones

Pre-defined milestone types that members select when logging a win. These create structured, comparable data across the member base.

```sql
win_milestones
  id              SERIAL PRIMARY KEY
  slug            TEXT NOT NULL UNIQUE
  name            TEXT NOT NULL
  description     TEXT
  icon            TEXT                       -- emoji or lucide icon
  category        TEXT NOT NULL              -- 'revenue', 'campaign', 'skill', 'lifestyle'
  sort_order      INTEGER DEFAULT 0
  xp_reward       INTEGER DEFAULT 0          -- future gamification hook
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
```

**Default milestones to seed:**

| Category | Milestone | Icon | Description |
|----------|-----------|------|-------------|
| Revenue | First Sale | 💰 | Made your first affiliate sale |
| Revenue | First Profitable Day | 📈 | First day with positive ROI |
| Revenue | First $100 Day | 💵 | Earned $100+ in a single day |
| Revenue | First $500 Day | 🔥 | Earned $500+ in a single day |
| Revenue | First $1K Day | 🚀 | Earned $1,000+ in a single day |
| Revenue | First $5K Day | ⭐ | Earned $5,000+ in a single day |
| Revenue | First $10K Day | 👑 | Earned $10,000+ in a single day |
| Revenue | First $10K Month | 🏆 | Earned $10,000+ in a calendar month |
| Revenue | First $50K Month | 💎 | Earned $50,000+ in a calendar month |
| Revenue | First $100K Month | 🌟 | Earned $100,000+ in a calendar month |
| Campaign | First Campaign Launched | 🎯 | Launched your first paid campaign |
| Campaign | First Winning Campaign | ✅ | First campaign with positive ROI after 7+ days |
| Campaign | First Scaled Campaign | 📊 | First campaign scaled past $100/day profitably |
| Campaign | 10 Campaigns Launched | 🔟 | Launched 10 total campaigns |
| Skill | Training Complete | 🎓 | Completed all foundational training modules |
| Skill | Advanced Training Complete | 🧠 | Completed all advanced training |
| Skill | First Advertorial Written | ✍️ | Wrote your first advertorial |
| Skill | First Split Test Run | 🧪 | Ran your first headline or creative split test |
| Lifestyle | Quit My Day Job | 🎉 | Left full-time employment to do affiliate marketing |
| Lifestyle | First Vacation From Earnings | ✈️ | Took a trip funded entirely by affiliate income |
| Custom | Custom Win | 🏅 | Something awesome that doesn't fit a category |

---

### 2. Win Submissions

#### Win Schema

```sql
wins
  id              SERIAL PRIMARY KEY
  user_id         INTEGER REFERENCES users(id) NOT NULL
  milestone_id    INTEGER REFERENCES win_milestones(id) NOT NULL
  
  -- Description
  title           TEXT NOT NULL              -- short headline: "Hit my first $1K day!"
  description     TEXT NOT NULL              -- full story (markdown, 100–2000 chars)
  
  -- Metrics (optional, depends on milestone type)
  revenue_amount  DECIMAL(12,2)             -- dollar amount (if revenue milestone)
  metric_label    TEXT                       -- custom metric label (e.g., "ROI", "CTR", "Days to profit")
  metric_value    TEXT                       -- custom metric value (e.g., "340%", "2.1%", "12 days")
  
  -- Proof
  proof_image_url TEXT                       -- screenshot upload (R2)
  proof_image_2_url TEXT                     -- optional second screenshot
  proof_verified  BOOLEAN DEFAULT false      -- admin has verified the proof
  
  -- Dates
  win_date        DATE NOT NULL              -- when the win actually happened
  
  -- Privacy & sharing
  share_to_community BOOLEAN DEFAULT true    -- auto-post to community Wins category
  community_post_id INTEGER REFERENCES community_posts(id)  -- linked community post if shared
  allow_testimonial  BOOLEAN DEFAULT false   -- member consents to marketing use
  allow_public_name  BOOLEAN DEFAULT false   -- show real name on marketing site (vs initials)
  
  -- Curation
  status          TEXT NOT NULL DEFAULT 'published'
    -- 'published'  → visible on wins wall and profile
    -- 'featured'   → admin promoted, highlighted on wins wall
    -- 'hidden'     → admin removed (guideline violation)
    -- 'draft'      → member saved but hasn't published
  
  featured_at     TIMESTAMP
  featured_by     INTEGER REFERENCES users(id)
  
  -- Testimonial pipeline
  testimonial_requested BOOLEAN DEFAULT false
  testimonial_text      TEXT                 -- member-written testimonial for marketing use
  testimonial_approved  BOOLEAN DEFAULT false
  testimonial_approved_by INTEGER REFERENCES users(id)
  testimonial_approved_at TIMESTAMP
  
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
```

**Indexes:**
- `(user_id, created_at DESC)` — member's wins
- `(milestone_id, created_at DESC)` — wins by milestone
- `(status, created_at DESC)` — wins wall feed
- `(testimonial_approved, featured_at DESC)` — marketing pipeline

#### Submission Flow

**Member navigates to /wins/submit:**

```
┌──────────────────────────────────────────────────────────────────┐
│  LOG A WIN 🏆                                                    │
│                                                                  │
│  What did you achieve?                                           │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  REVENUE              CAMPAIGN            SKILL          │    │
│  │  💰 First Sale         🎯 First Launch     🎓 Training    │    │
│  │  📈 Profitable Day     ✅ Winning Camp.    ✍️ First Advert│    │
│  │  💵 $100 Day           📊 Scaled Camp.     🧪 First Split │    │
│  │  🔥 $500 Day           🔟 10 Campaigns                    │    │
│  │  🚀 $1K Day                               LIFESTYLE      │    │
│  │  ⭐ $5K Day            CUSTOM             🎉 Quit Job     │    │
│  │  👑 $10K Day           🏅 Custom Win       ✈️ Vacation    │    │
│  │  🏆 $10K Month                                            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  (after selecting milestone:)                                    │
│                                                                  │
│  Title:                                                          │
│  [Hit my first $1K day! 🚀_________________________________]    │
│                                                                  │
│  Tell your story:                                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ After 3 weeks of testing headlines using the Module 4    │    │
│  │ framework, I finally cracked the code in the health      │    │
│  │ niche. Started with $50/day budget and scaled to $200... │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  When did this happen?                                           │
│  [March 15, 2026_____]                                          │
│                                                                  │
│  Revenue amount (optional):                                      │
│  [$________1,247.50]                                            │
│                                                                  │
│  Upload proof screenshot:                                        │
│  [📷 Drop image here or click to upload]                         │
│  (Dashboard screenshot, earnings report, etc.)                   │
│                                                                  │
│  ── SHARING OPTIONS ─────────────────────────────────────────    │
│                                                                  │
│  ☑ Share this win to the BTS community                           │
│  ☐ I consent to BTS using this win as a testimonial              │
│    (on the website, in marketing materials, or in ads)           │
│  ☐ You may use my full name (otherwise we'll use first name     │
│    + last initial)                                               │
│                                                                  │
│              [Save as Draft]    [Publish Win 🏆]                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**On publish:**
1. Create win record with status 'published'
2. Upload proof image to R2: `wins/{user_id}/{win_id}_{timestamp}.{ext}`
3. If `share_to_community` is true: auto-create a community post in the "Wins" category with the win content and link back to the win detail page
4. Award milestone badge if this is the member's first win of this milestone type
5. TODO: Notify admin of new win (for curation pipeline)
6. TODO: GHL sync — add tag `win:{milestone_slug}`, update custom field `latest_win`

---

### 3. Wins Wall (`/wins`)

A dedicated page showcasing all member wins — the social proof engine.

```
┌──────────────────────────────────────────────────────────────────┐
│  WINS WALL 🏆                                        [Log a Win] │
│                                                                  │
│  Real results from real BTS members.                             │
│                                                                  │
│  [All] [Revenue 💰] [Campaign 🎯] [Skill 🎓] [Lifestyle 🎉]    │
│                                                                  │
│  ── FEATURED WINS ───────────────────────────────────────────    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  ⭐ FEATURED                                              │    │
│  │  [Avatar] Marcus J. · 6-Month Mentorship                 │    │
│  │  🚀 First $1K Day · March 15, 2026                        │    │
│  │                                                          │    │
│  │  "After 3 weeks of testing headlines using the Module 4  │    │
│  │   framework, I finally cracked the code..."              │    │
│  │                                                          │    │
│  │  Revenue: $1,247.50                                      │    │
│  │  [Proof screenshot thumbnail — click to expand]          │    │
│  │                                                          │    │
│  │  🔥 34  💬 12 comments                                    │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ── ALL WINS ────────────────────────────────────────────────    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ [Avatar]     │  │ [Avatar]     │  │ [Avatar]     │           │
│  │ Sarah C.     │  │ Alex R.      │  │ Jordan T.    │           │
│  │ 💰 First Sale│  │ 📈 Profitable│  │ 🎯 First     │           │
│  │              │  │    Day       │  │    Launch    │           │
│  │ "Finally got │  │ "Day 12 and │  │ "Just hit    │           │
│  │  my first..." │ │  already..."  │ │  publish..." │           │
│  │              │  │              │  │              │           │
│  │ 🔥 8        │  │ 🔥 15       │  │ 🔥 6        │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  [Load more...]                                                  │
│                                                                  │
│  ── YOUR WIN STREAK ─────────────────────────────────────────    │
│  Milestones achieved: 4 of 20  ░░░░████████░░░░░░░░░░ 20%       │
│  Next milestone: 🔥 First $500 Day                               │
│  [View your wins →]                                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Sorting:**
- Featured wins always at top
- Then by `created_at DESC` (newest first)
- Filter by milestone category
- Members without `community:access` can still view the wins wall (it's motivational for front-end buyers too) but can't comment. Restrict to authenticated members only.

---

### 4. Member Win Profile (`/wins/mine` or tab on account page)

Each member has a personal wins timeline showing their journey.

```
┌──────────────────────────────────────────────────────────────────┐
│  YOUR WINS                                           [Log a Win] │
│                                                                  │
│  ── MILESTONE TRACKER ───────────────────────────────────────    │
│                                                                  │
│  💰 ✅  📈 ✅  💵 ✅  🔥 ⬜  🚀 ⬜  ⭐ ⬜  👑 ⬜             │
│  First  Profit  $100   $500  $1K    $5K   $10K               │
│  Sale   Day     Day    Day   Day    Day   Day                │
│                                                                  │
│  🎯 ✅  ✅ ⬜  📊 ⬜  🔟 ⬜                                   │
│  First  Winning Scaled 10                                        │
│  Launch Campaign Camp.  Camps                                    │
│                                                                  │
│  ── YOUR WIN TIMELINE ───────────────────────────────────────    │
│                                                                  │
│  March 15, 2026                                                  │
│  💵 First $100 Day · Revenue: $147.50                            │
│  "Module 4 headline testing framework worked..."                 │
│  [View] [Edit] [Delete]                                          │
│                                                                  │
│  February 28, 2026                                               │
│  📈 First Profitable Day · Revenue: $23.40                       │
│  "Small profit but it proves the model works..."                 │
│  [View] [Edit] [Delete]                                          │
│                                                                  │
│  February 10, 2026                                               │
│  💰 First Sale · Revenue: $45.00                                 │
│  "Can't believe it finally happened..."                          │
│  [View] [Edit] [Delete]                                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

### 5. Admin Curation Pipeline

The admin side turns raw member wins into marketing assets.

#### Curation Queue (`/admin/wins`)

```
┌──────────────────────────────────────────────────────────────────┐
│  WIN CURATION                                                    │
│                                                                  │
│  [All Wins] [Needs Review] [Featured] [Testimonial Pipeline]    │
│                                                                  │
│  ── NEEDS REVIEW (12 new this week) ─────────────────────────    │
│                                                                  │
│  Member        Milestone       Revenue    Proof  Testimonial     │
│  ────────────────────────────────────────────────────────────    │
│  Marcus J.     $1K Day         $1,247     ✅     ☐ Not asked    │
│  Sarah C.      First Sale      $45        ✅     ☐ Not asked    │
│  Alex R.       Profitable Day  $23        ⬜     ☐ Not asked    │
│                                                                  │
│  Actions: [Feature ⭐] [Request Testimonial 📝] [Verify ✓]      │
│           [Hide 🚫] [View Details]                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Admin actions:**

| Action | What It Does |
|--------|-------------|
| Feature ⭐ | Promotes to featured section on Wins Wall. Sets `featured_at` and `featured_by` |
| Verify ✓ | Marks proof as admin-verified. Shows "Verified" badge on the win |
| Request Testimonial 📝 | Sends an email to the member asking them to write a testimonial. Sets `testimonial_requested` |
| Approve Testimonial ✅ | Marks submitted testimonial as approved for marketing use |
| Hide 🚫 | Removes from wins wall (guideline violation, suspicious proof) |

#### Testimonial Request Flow

```
1. Admin clicks "Request Testimonial" on a win
2. System sends email via SendGrid:
   Subject: "Your BTS win inspired us — would you share your story?"
   Body: Personalized message referencing their specific win, 
   with a link to /wins/:id/testimonial
3. Member clicks link → lands on a testimonial submission form:
   - Pre-filled with their win details
   - Text area for a 2–4 sentence testimonial
   - Checkbox: "I consent to BTS using this testimonial in marketing materials"
   - Checkbox: "You may use my full name" (vs first name + last initial)
   - Optional: upload a headshot or video testimonial
4. Member submits → testimonial_text saved on win record
5. Admin reviews and approves → testimonial_approved = true
6. Approved testimonial is now available via the marketing API
```

---

### 6. Marketing API (Public Testimonials)

Approved, featured wins with testimonials are exposed via a public API endpoint that the marketing site can consume.

```
GET /api/v1/marketing/testimonials?limit=10&category=revenue

Response:
{
  "data": [
    {
      "id": 42,
      "memberName": "Marcus J.",          // or full name if allow_public_name
      "memberProductLevel": "6-Month Mentorship",
      "milestone": "First $1K Day",
      "milestoneIcon": "🚀",
      "revenueAmount": 1247.50,
      "testimonialText": "BTS completely changed my approach to affiliate marketing. The headline testing framework from Module 4 took me from break-even to my first $1K day in just 3 weeks.",
      "winDate": "2026-03-15",
      "proofVerified": true,
      "proofImageUrl": "https://r2.../wins/42/proof.jpg",  // only if member consented
      "avatarUrl": "https://r2.../avatars/42.jpg",
      "createdAt": "2026-03-16T10:00:00Z"
    }
  ]
}
```

**This endpoint requires NO authentication** — it's consumed by the static marketing site at build time or client-side. Only returns wins where `testimonial_approved = true` AND (`allow_testimonial = true`).

**Filtering:**
- `category`: revenue, campaign, skill, lifestyle
- `milestone`: specific milestone slug
- `min_revenue`: minimum revenue amount (for impressive numbers)
- `featured_only`: only featured wins
- `limit`: number of results (max 50)
- `random`: return random selection (for rotating testimonials)

---

### 7. Dashboard Widget

Add a "Wins" widget to the member dashboard:

```
┌─ YOUR WINS 🏆 ─────────────────────────────────────┐
│                                                      │
│  Milestones achieved: 4 of 20                        │
│  ░░░░████████░░░░░░░░░░ 20%                          │
│                                                      │
│  Latest: 💵 First $100 Day (March 15)                │
│  Next: 🔥 First $500 Day — you're getting close!     │
│                                                      │
│  [Log a Win] [View Wins Wall]                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

### 8. Win Badges (Community Integration)

Wins integrate with the community badge system:

| Badge | Criteria | Icon |
|-------|----------|------|
| First Win | Any win logged | 🏆 |
| Revenue Earner | Any revenue milestone | 💰 |
| $1K Club | $1K Day or $10K Month milestone | 🚀 |
| $10K Club | $10K Day or $100K Month milestone | 👑 |
| Win Streak | 3+ wins logged in 30 days | 🔥 |
| Verified Winner | At least 1 admin-verified win | ✅ |

Badges are awarded automatically when a win is published that meets the criteria.

---

### 9. Database Schema Summary

```sql
win_milestones (
  id, slug, name, description, icon, category, sort_order, xp_reward, is_active, created_at
)

wins (
  id, user_id, milestone_id, title, description,
  revenue_amount, metric_label, metric_value,
  proof_image_url, proof_image_2_url, proof_verified,
  win_date, share_to_community, community_post_id,
  allow_testimonial, allow_public_name,
  status, featured_at, featured_by,
  testimonial_requested, testimonial_text,
  testimonial_approved, testimonial_approved_by, testimonial_approved_at,
  created_at, updated_at
)
```

---

### 10. API Endpoints

```
# Member
GET    /api/v1/wins                        → Wins wall (paginated, filterable)
GET    /api/v1/wins/mine                   → Member's own wins
GET    /api/v1/wins/:id                    → Win detail
POST   /api/v1/wins                        → Submit win
PATCH  /api/v1/wins/:id                    → Edit win
DELETE /api/v1/wins/:id                    → Delete win
POST   /api/v1/wins/:id/testimonial        → Submit testimonial text
GET    /api/v1/wins/milestones             → List available milestones
GET    /api/v1/wins/milestones/progress    → Member's milestone progress

# Marketing (public, no auth)
GET    /api/v1/marketing/testimonials      → Approved testimonials for marketing site

# Admin
GET    /api/v1/admin/wins                  → All wins with curation filters
PATCH  /api/v1/admin/wins/:id/feature      → Feature/unfeature a win
PATCH  /api/v1/admin/wins/:id/verify       → Verify proof
PATCH  /api/v1/admin/wins/:id/hide         → Hide a win
POST   /api/v1/admin/wins/:id/request-testimonial → Send testimonial request email
PATCH  /api/v1/admin/wins/:id/approve-testimonial → Approve testimonial for marketing
GET    /api/v1/admin/wins/analytics        → Win analytics (submissions/week, top milestones, etc.)
```

---

## Definition of Done

1. Members can log wins with milestone type, description, proof screenshot, and optional revenue
2. Wins wall displays all published wins with featured wins at top
3. Milestone tracker on member profile shows progress across all milestone types
4. Community integration: wins auto-post to Wins category when opted in
5. Admin curation queue: feature, verify, hide, and request testimonials
6. Testimonial pipeline: request → member submits → admin approves → marketing API
7. Public testimonial API serves approved wins for the marketing site
8. Win badges awarded automatically via community badge system
9. Dashboard widget shows milestone progress and next goal
10. Proof images uploaded to R2 with proper access controls
