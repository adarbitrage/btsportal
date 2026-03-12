# BTS Portal — Revenue Intelligence Dashboard Build Spec

**Priority:** Post-launch enhancement
**Status:** Not started
**Depends on:** Auth, ThriveCart Webhooks, Entitlement system, Commission system, Communications
**Reference:** New feature (not in original PRD)

---

## Context

The admin dashboard (spec #14) shows basic KPIs. This spec builds a deep revenue intelligence layer — the analytical engine that tells Adam exactly what's working, what's at risk, and where the next dollar is hiding. This is the data-driven command center for running BTS as a business.

---

## What to Build

### 1. Revenue Dashboard (`/admin/revenue`)

The primary view — a real-time overview of the business financials.

```
┌──────────────────────────────────────────────────────────────────┐
│  REVENUE INTELLIGENCE                    Period: [This Month ▼]  │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ MRR      │ │ NEW REV  │ │ EXPANSION│ │ CHURNED  │           │
│  │ $87,400  │ │ $23,100  │ │ $12,800  │ │ -$4,200  │           │
│  │ ↑ 14%    │ │ 47 new   │ │ 22 upgr  │ │ 8 cancel │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ ARR      │ │ AVG LTV  │ │ CAC      │ │ LTV:CAC  │           │
│  │ $1.05M   │ │ $847     │ │ $62      │ │ 13.7:1   │           │
│  │          │ │ ↑ $23    │ │ ↓ $4     │ │          │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Revenue trend chart — 12 months]                       │    │
│  │  Lines: Total MRR, New, Expansion, Churned               │    │
│  │  Stacked area or line chart                               │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Revenue by product — bar chart]                         │    │
│  │  Each of the 8 products as a bar with revenue total       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2. Metrics Engine

A background service that computes and caches revenue metrics daily. Expensive aggregations run nightly and are served from a metrics cache table.

```sql
revenue_metrics_cache
  id              SERIAL PRIMARY KEY
  metric_key      TEXT NOT NULL              -- 'mrr', 'arr', 'avg_ltv', 'churn_rate', etc.
  metric_value    DECIMAL(14,2) NOT NULL
  period_type     TEXT NOT NULL              -- 'daily', 'monthly', 'all_time'
  period_date     DATE NOT NULL             -- the date or first-of-month this metric covers
  dimensions      JSONB                      -- optional segmentation: { product: '6month', funnel: 'reserve' }
  computed_at     TIMESTAMP DEFAULT NOW()
  UNIQUE(metric_key, period_type, period_date, dimensions)
```

#### Core Metrics

| Metric | Calculation | Period |
|--------|-------------|--------|
| MRR | Sum of active recurring subscription monthly values | Monthly snapshot |
| ARR | MRR × 12 | Monthly snapshot |
| New Revenue | Revenue from first-time purchasers this period | Monthly |
| Expansion Revenue | Revenue from upgrades this period | Monthly |
| Churned Revenue | Lost revenue from cancellations/expirations this period | Monthly |
| Net Revenue | New + Expansion - Churned | Monthly |
| Average LTV | Total lifetime revenue / total members who have ever purchased | Rolling |
| LTV by Product | Average total spend of members who started with each product | Per product |
| CAC | Total ad spend / new members acquired (requires manual input or integration) | Monthly |
| LTV:CAC Ratio | Avg LTV / CAC | Monthly |
| ARPU | Total revenue / active members | Monthly |
| Churn Rate | Members who cancelled or expired / total active at period start | Monthly |
| Retention Rate | 1 - churn rate | Monthly |
| Upgrade Rate | Members who bought a higher product / eligible members | Monthly |
| Refund Rate | Refunds / total purchases | Monthly |
| Revenue per Funnel | Revenue attributed to each of the 3 front-end funnels | Monthly |

### 3. Cohort Analysis (`/admin/revenue/cohorts`)

Track how member cohorts (grouped by signup month) behave over time.

```
┌──────────────────────────────────────────────────────────────────┐
│  COHORT ANALYSIS                        Metric: [Revenue ▼]      │
│                                                                  │
│  Signup    M0      M1      M2      M3      M4      M5      M6   │
│  ─────────────────────────────────────────────────────────────   │
│  Jan 26   $12,400  $2,100  $1,800  $3,200  $1,400  $900   $600  │
│  Feb 26   $18,700  $3,400  $2,900  $4,100  $2,100  $1,200       │
│  Mar 26   $23,100  $4,200  $3,100  ...                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Cohort heatmap visualization]                           │    │
│  │  Darker = higher revenue/retention                        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Toggles: [Revenue] [Retention %] [Upgrade %] [Active Members]   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Cohort dimensions:**
- Default: signup month
- Alternative: source funnel (Reserve Income vs Backroad vs Off-Market)
- Alternative: first product purchased
- Alternative: experience level (from profile)

**Cohort metrics:**
- Cumulative revenue per cohort over time
- Retention % (still active N months after signup)
- Upgrade % (purchased a higher product N months after signup)
- Active member count per month

### 4. Churn Prediction & At-Risk Detection (`/admin/revenue/at-risk`)

An engagement-based scoring system that predicts which members are likely to churn and flags them for intervention.

#### Member Health Score

Each active member gets a health score (0–100) computed from weighted engagement signals:

```
Health Score Components:
─────────────────────────────────────────
Login frequency (last 30 days)           Weight: 25%
  Daily login = 100, Weekly = 70, Biweekly = 40, Monthly = 20, None = 0

Training progress velocity               Weight: 20%
  Completing lessons regularly = 100, Stalled = 30, Never started = 0

Coaching call attendance                  Weight: 15%
  Attending most calls = 100, Occasional = 50, Never = 0

Community engagement                      Weight: 10%
  Active poster/commenter = 100, Lurker = 30, Never visited = 0

Tool usage (last 30 days)                Weight: 10%
  Regular use = 100, Occasional = 50, Never = 0

Support tickets                           Weight: 10%
  Resolved positively = boost, Unresolved = penalty

Recency of any activity                  Weight: 10%
  Today = 100, This week = 80, This month = 50, 30+ days = 0
```

```sql
member_health_scores
  id              SERIAL PRIMARY KEY
  user_id         INTEGER REFERENCES users(id) NOT NULL UNIQUE
  health_score    INTEGER NOT NULL           -- 0–100
  risk_level      TEXT NOT NULL              -- 'healthy', 'watch', 'at_risk', 'critical'
  
  -- Component scores (for drill-down)
  login_score     INTEGER
  training_score  INTEGER
  coaching_score  INTEGER
  community_score INTEGER
  tool_score      INTEGER
  support_score   INTEGER
  recency_score   INTEGER
  
  -- Trend
  previous_score  INTEGER                   -- last period's score
  score_trend     TEXT                       -- 'improving', 'stable', 'declining'
  
  -- Alerts
  days_inactive   INTEGER                   -- consecutive days without login
  
  computed_at     TIMESTAMP DEFAULT NOW()
```

**Risk levels:**

| Score | Level | Meaning | Auto-Action |
|-------|-------|---------|-------------|
| 80–100 | Healthy 🟢 | Engaged, active, low churn risk | None |
| 60–79 | Watch 🟡 | Engagement declining, monitor | GHL tag: `health_watch` |
| 30–59 | At Risk 🟠 | Significant disengagement | GHL tag: `health_at_risk` + re-engagement sequence |
| 0–29 | Critical 🔴 | Very likely to churn | GHL tag: `health_critical` + admin alert + retention task |

#### At-Risk Dashboard

```
┌──────────────────────────────────────────────────────────────────┐
│  AT-RISK MEMBERS                                                 │
│                                                                  │
│  🔴 Critical: 8    🟠 At Risk: 23    🟡 Watch: 45    🟢 Healthy: 1,171│
│                                                                  │
│  ── CRITICAL (Immediate Attention) ──────────────────────────    │
│                                                                  │
│  Member        Product      Score  Trend   Days     Expiration   │
│                                             Inactive              │
│  ────────────────────────────────────────────────────────────    │
│  Jordan T.    6-Month       18     ↓↓      34 days  Jun 1       │
│  Casey M.     3-Month       22     ↓       21 days  May 15      │
│  Morgan L.    1-Year        25     ↓       28 days  Jan 2027    │
│                                                                  │
│  [Send retention email] [Create GHL task] [View profile]         │
│                                                                  │
│  ── AT RISK ─────────────────────────────────────────────────    │
│  ...                                                             │
│                                                                  │
│  ── CHURN PREDICTION ────────────────────────────────────────    │
│  Members most likely to NOT renew (next 30 days):                │
│  1. Jordan T. (6-Month, expires Jun 1) — 87% churn probability   │
│  2. Casey M. (3-Month, expires May 15) — 74% churn probability   │
│  3. ...                                                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Churn probability** is calculated for members with expiring mentorships:

```
Churn probability = weighted combination of:
- Health score (inverted: lower health = higher churn probability)
- Days until expiration (closer = more predictive)
- Historical upgrade/renewal rate for their product tier
- Time since last login
- Support satisfaction scores
- Community engagement level
```

This doesn't need to be a sophisticated ML model for v1. A weighted formula that produces a reasonable ranking is sufficient and valuable. Calibrate weights over time based on actual churn data.

### 5. Upgrade Probability Scoring (`/admin/revenue/upgrade-opportunities`)

Identify front-end and LaunchPad members most likely to upgrade to mentorship.

```
┌──────────────────────────────────────────────────────────────────┐
│  UPGRADE OPPORTUNITIES                                           │
│                                                                  │
│  Members most likely to upgrade (sorted by probability):         │
│                                                                  │
│  Member        Current        Score  Training  Last     Suggested│
│                Product               Progress  Active   Upgrade  │
│  ────────────────────────────────────────────────────────────    │
│  Sarah C.     Reserve Income  92%    Module 5  Today    LaunchPad│
│  Maria L.     Backroad        87%    Module 4  2 days   LaunchPad│
│  Jamie K.     LaunchPad       84%    100%      Today    3-Month  │
│  ...                                                             │
│                                                                  │
│  Actions: [Send upgrade email] [Create GHL task] [View profile]  │
│                                                                  │
│  ── UPGRADE FUNNEL METRICS ──────────────────────────────────    │
│  Front-end → LaunchPad:    12.3% conversion (avg 8 days)         │
│  LaunchPad → 3-Month:      18.7% conversion (avg 14 days)       │
│  3-Month → 6-Month:        34.2% conversion (avg 45 days)       │
│  6-Month → 1-Year:         22.1% conversion (avg 90 days)       │
│  1-Year → Lifetime:        15.8% conversion (avg 180 days)      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Upgrade probability signals:**
- Training progress (further along = more invested = more likely)
- Login frequency (high engagement = ready for more)
- Tool usage (using tools = getting value = wants more)
- AI chat usage (asking questions = engaged = might need coaching)
- Time since purchase (sweet spot varies by product, typically 7–21 days for front-end→LaunchPad)
- Community engagement (if they found community via a guest peek)
- Support ticket resolution (positive resolution = trust = upgrade-ready)

### 6. Funnel Performance (`/admin/revenue/funnels`)

Compare the three front-end funnels head-to-head.

```
┌──────────────────────────────────────────────────────────────────┐
│  FUNNEL PERFORMANCE                      Period: [Last 30 Days]  │
│                                                                  │
│              Reserve Income  Backroad    Off-Market               │
│  ────────────────────────────────────────────────────────────    │
│  Purchases    234            189         156                     │
│  Revenue      $16,380        $13,230     $10,920                 │
│  Avg Price    $70            $70         $70                     │
│  Refund Rate  4.2%           3.8%        5.1%                    │
│  → LaunchPad  14.1%          11.6%       9.8%                    │
│  → Mentorship 8.2%           6.9%        5.4%                    │
│  Avg LTV      $234           $198        $167                    │
│  ────────────────────────────────────────────────────────────    │
│  WINNER: Reserve Income (highest LTV and upgrade rate)           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Funnel comparison chart — grouped bar chart]            │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ── UPGRADE PATHS BY FUNNEL ─────────────────────────────────    │
│  Reserve Income: 67% upgrade to LaunchPad first, 33% skip to    │
│  mentorship directly                                             │
│  ...                                                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 7. LTV Analysis (`/admin/revenue/ltv`)

Deep dive into customer lifetime value.

```
┌──────────────────────────────────────────────────────────────────┐
│  LIFETIME VALUE ANALYSIS                                         │
│                                                                  │
│  Overall Avg LTV: $847                                           │
│                                                                  │
│  ── LTV BY FIRST PRODUCT ────────────────────────────────────    │
│  Reserve Income buyers: $234 avg LTV (544 members)               │
│  Backroad buyers: $198 avg LTV (423 members)                     │
│  Off-Market buyers: $167 avg LTV (312 members)                   │
│  LaunchPad buyers (direct): $512 avg LTV (89 members)            │
│  Mentorship buyers (direct): $1,247 avg LTV (34 members)         │
│                                                                  │
│  ── LTV BY EXPERIENCE LEVEL ─────────────────────────────────    │
│  Beginner: $312 avg LTV                                          │
│  Some Experience: $567 avg LTV                                   │
│  Intermediate: $1,023 avg LTV                                    │
│  Advanced: $1,890 avg LTV                                        │
│                                                                  │
│  ── LTV DISTRIBUTION ────────────────────────────────────────    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Histogram: member count by LTV bucket]                  │    │
│  │  $0-100: ████████ 456                                     │    │
│  │  $100-500: ██████ 312                                     │    │
│  │  $500-1K: ████ 189                                        │    │
│  │  $1K-5K: ██ 78                                            │    │
│  │  $5K+: █ 12                                               │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 8. Revenue Forecasting

Simple projection based on current trends:

```
┌──────────────────────────────────────────────────────────────────┐
│  REVENUE FORECAST (Next 12 Months)                               │
│                                                                  │
│  Based on: current growth rate, retention, and upgrade patterns  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Line chart: projected MRR with confidence interval]     │    │
│  │  Solid line: projected                                    │    │
│  │  Shaded area: optimistic / pessimistic range              │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Conservative: $1.2M ARR by March 2027                           │
│  Base case: $1.8M ARR by March 2027                              │
│  Optimistic: $2.4M ARR by March 2027                             │
│                                                                  │
│  Key assumptions:                                                │
│  • New member growth: 12% MoM (current: 14%)                    │
│  • Churn rate: 6% (current: 4.2%)                                │
│  • Upgrade rate: 22% of front-end to backend (current: 24%)     │
│  • Avg revenue per new member: $70 (front-end) + $234 LTV uplift│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 9. Manual Data Input

Some metrics require data from outside the portal (ad spend, external revenue). Provide a simple input mechanism:

```
POST /api/v1/admin/revenue/manual-entry
{
  "metric": "ad_spend",
  "period": "2026-03",
  "value": 14500.00,
  "source": "Meta Ads + NewsBreak combined",
  "enteredBy": 1
}
```

```sql
revenue_manual_entries
  id              SERIAL PRIMARY KEY
  metric          TEXT NOT NULL              -- 'ad_spend', 'external_revenue', etc.
  period          TEXT NOT NULL              -- '2026-03' (YYYY-MM format)
  value           DECIMAL(14,2) NOT NULL
  source          TEXT
  entered_by      INTEGER REFERENCES users(id)
  created_at      TIMESTAMP DEFAULT NOW()
  UNIQUE(metric, period)
```

This lets Adam input monthly ad spend so CAC and LTV:CAC calculations work without a direct ad platform integration.

---

### 10. Nightly Computation Job

```
computeRevenueMetrics() — runs nightly at 2 AM:

1. Calculate MRR from active subscriptions
2. Calculate new/expansion/churned revenue for the day/month
3. Compute LTV per member and averages by segment
4. Run health score computation for all active members
5. Compute churn probability for expiring memberships
6. Compute upgrade probability for eligible members
7. Update cohort tables
8. Cache all results in revenue_metrics_cache
9. Trigger GHL tag updates for health score changes
10. Generate admin alerts for critical risk members
```

---

### 11. API Endpoints

```
GET    /api/v1/admin/revenue/dashboard            → KPI summary
GET    /api/v1/admin/revenue/trends                → Revenue trend data (chart-ready)
GET    /api/v1/admin/revenue/cohorts               → Cohort analysis data
GET    /api/v1/admin/revenue/at-risk               → At-risk member list with scores
GET    /api/v1/admin/revenue/upgrade-opportunities  → Upgrade probability rankings
GET    /api/v1/admin/revenue/funnels               → Funnel comparison data
GET    /api/v1/admin/revenue/ltv                   → LTV analysis
GET    /api/v1/admin/revenue/forecast              → Revenue projections
GET    /api/v1/admin/revenue/health-scores          → All member health scores
GET    /api/v1/admin/revenue/health-scores/:userId  → Individual health score breakdown
POST   /api/v1/admin/revenue/manual-entry           → Input external data (ad spend, etc.)
POST   /api/v1/admin/revenue/recompute             → Force recomputation of all metrics
```

---

## Definition of Done

1. Revenue dashboard shows MRR, ARR, new/expansion/churned revenue, LTV, CAC, and LTV:CAC
2. Revenue trend chart shows 12-month history with breakdown by type
3. Cohort analysis shows retention and revenue curves by signup month
4. Health scores computed nightly for every active member (0–100 with risk level)
5. At-risk dashboard ranks critical and at-risk members with actionable interventions
6. Churn probability calculated for members with expiring mentorships
7. Upgrade probability identifies front-end/LaunchPad members most likely to convert
8. Funnel performance compares the 3 front-end funnels on all key metrics
9. LTV analysis segments by first product, experience level, and funnel source
10. Revenue forecast projects 12-month MRR with confidence intervals
11. Manual data entry allows inputting ad spend for CAC calculations
12. All metrics cached nightly for fast dashboard loading
