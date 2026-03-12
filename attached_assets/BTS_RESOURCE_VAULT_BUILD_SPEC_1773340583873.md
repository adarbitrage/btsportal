# BTS Portal — Resource Vault Build Spec

**Priority:** Post-launch enhancement
**Status:** Not started
**Depends on:** Auth, Entitlement system, Cloudflare R2, Training system
**Reference:** New feature (not in original PRD)

---

## Context

Training lessons have downloadable resources attached to individual lessons, and affiliate resources exist in the commission system. But there's no centralized, searchable library where members can find swipe files, templates, case studies, SOPs, and reference materials across the entire BTS ecosystem.

The Resource Vault is a standalone library — think Google Drive meets Notion's wiki — where all BTS resources live in one searchable, categorized, entitlement-gated location. Members can browse by category, search by keyword, filter by type, favorite resources for quick access, and download or preview everything from one place.

---

## What to Build

### 1. Resource Schema

```sql
vault_resources
  id              SERIAL PRIMARY KEY
  title           TEXT NOT NULL
  description     TEXT NOT NULL              -- 1-3 sentence summary
  long_description TEXT                      -- optional detailed description (markdown)
  
  -- Categorization
  collection_id   INTEGER REFERENCES vault_collections(id) NOT NULL
  tags            TEXT[] NOT NULL DEFAULT '{}' -- searchable tags
  resource_type   TEXT NOT NULL              -- see types below
  
  -- Content
  file_url        TEXT                       -- R2 URL for downloadable files
  file_size       INTEGER                    -- bytes
  file_format     TEXT                       -- 'pdf', 'xlsx', 'docx', 'zip', 'png', 'mp4', etc.
  preview_url     TEXT                       -- thumbnail or preview image (R2)
  content_html    TEXT                       -- for text/article type resources (rendered in-portal)
  external_url    TEXT                       -- for link type resources (external tool, video, etc.)
  
  -- Access control
  required_entitlement TEXT                  -- null = all members, otherwise entitlement key
  
  -- Metadata
  author          TEXT                       -- 'BTS Team', coach name, or 'Community'
  version         TEXT DEFAULT '1.0'         -- for templates that get updated
  updated_note    TEXT                       -- "Updated March 2026: Added NewsBreak section"
  
  -- Engagement
  download_count  INTEGER DEFAULT 0
  view_count      INTEGER DEFAULT 0
  favorite_count  INTEGER DEFAULT 0
  
  -- Display
  is_featured     BOOLEAN DEFAULT false
  is_new          BOOLEAN DEFAULT false       -- shows "NEW" badge (auto-cleared after 14 days)
  is_pinned       BOOLEAN DEFAULT false       -- pinned to top of collection
  sort_order      INTEGER DEFAULT 0
  
  -- Status
  status          TEXT NOT NULL DEFAULT 'published'  -- 'draft', 'published', 'archived'
  published_at    TIMESTAMP
  
  created_at      TIMESTAMP DEFAULT NOW()
  updated_at      TIMESTAMP DEFAULT NOW()
```

### 2. Resource Types

| Type | Icon | Description | How It's Consumed |
|------|------|-------------|-------------------|
| `template` | 📄 | Fillable templates (campaign plans, ad copy frameworks, checklists) | Download (PDF, XLSX, DOCX) |
| `swipe_file` | 📋 | Proven examples to model (winning headlines, ad copy, landing pages) | Download or view in-portal |
| `case_study` | 📊 | Detailed breakdowns of real campaigns with metrics | Read in-portal (markdown) |
| `sop` | 📝 | Step-by-step standard operating procedures | Read in-portal (markdown) |
| `cheat_sheet` | ⚡ | Quick-reference guides (1-2 pages) | Download (PDF) or view |
| `video` | 🎥 | Tutorial or walkthrough video | Embedded player (Vimeo/Wistia) |
| `tool` | 🔧 | Spreadsheet tools, calculators, or interactive resources | Download (XLSX) or link to portal tool |
| `image_pack` | 🖼️ | Image assets, ad creative templates, design resources | Download (ZIP) |
| `guide` | 📖 | Long-form reference guides (multi-page) | Download (PDF) or read in-portal |
| `link` | 🔗 | External resource (third-party tool, article, reference) | Opens in new tab |

### 3. Collections

Resources are organized into collections (like folders/categories). Collections can be nested one level deep.

```sql
vault_collections
  id              SERIAL PRIMARY KEY
  parent_id       INTEGER REFERENCES vault_collections(id)  -- null for top-level
  name            TEXT NOT NULL
  slug            TEXT NOT NULL UNIQUE
  description     TEXT
  icon            TEXT                       -- emoji or lucide icon
  cover_image_url TEXT                       -- optional collection cover image
  required_entitlement TEXT                  -- null = all members with vault access
  resource_count  INTEGER DEFAULT 0          -- denormalized
  sort_order      INTEGER DEFAULT 0
  is_active       BOOLEAN DEFAULT true
  created_at      TIMESTAMP DEFAULT NOW()
```

**Default collections to seed:**

| Collection | Icon | Entitlement | Description |
|------------|------|-------------|-------------|
| Campaign Templates | 📄 | content:frontend | Campaign planning, budget allocation, and tracking templates |
| → Ad Copy Templates | ✍️ | content:frontend | Sub-collection: headline frameworks, ad copy templates |
| → Landing Page Templates | 🖥️ | content:frontend | Sub-collection: landing page copy frameworks |
| Swipe Files | 📋 | content:frontend | Proven examples of winning ads, headlines, and pages |
| → Winning Headlines | 🏆 | content:frontend | Sub: curated winning headline examples with analysis |
| → Advertorial Examples | 📰 | content:advanced | Sub: full advertorial breakdowns |
| Case Studies | 📊 | content:advanced | Real campaign breakdowns with metrics and takeaways |
| SOPs & Processes | 📝 | software:base | Step-by-step operating procedures |
| → Campaign Launch SOP | 🚀 | software:base | Sub: end-to-end campaign launch checklist |
| → Optimization SOP | ⚡ | software:base | Sub: campaign optimization playbook |
| Cheat Sheets | ⚡ | content:frontend | Quick-reference guides for common tasks |
| Video Tutorials | 🎥 | content:frontend | Supplementary video walkthroughs |
| Design Assets | 🖼️ | software:base | Ad creative templates, image packs, design resources |
| Compliance Library | ⚖️ | content:frontend | Platform policies, compliance checklists, approved language |
| Traffic Source Guides | 📡 | content:advanced | Deep-dive guides for each traffic source |
| Mentor Resources | 👨‍🏫 | coaching:group | Coach-curated resources from coaching sessions |

---

### 4. Resource Vault Page (`/resources`)

```
┌──────────────────────────────────────────────────────────────────┐
│  RESOURCE VAULT                                                  │
│                                                                  │
│  [🔍 Search resources..._________________________________]       │
│                                                                  │
│  Filters: [All Types ▼] [All Collections ▼] [Favorites ♡]       │
│  Sort: [Most Popular ▼] [Newest] [A-Z]                          │
│                                                                  │
│  ── FEATURED ────────────────────────────────────────────────    │
│                                                                  │
│  ┌────────────────────────┐  ┌────────────────────────┐          │
│  │ 📄 Campaign Launch     │  │ 📋 50 Winning Headlines│          │
│  │    Checklist           │  │    Swipe File          │          │
│  │ ⭐ FEATURED            │  │ ⭐ FEATURED · NEW      │          │
│  │                        │  │                        │          │
│  │ Step-by-step checklist │  │ Curated collection of  │          │
│  │ for launching your     │  │ proven headlines with   │          │
│  │ first campaign.        │  │ analysis.              │          │
│  │                        │  │                        │          │
│  │ PDF · 2.4 MB           │  │ PDF · 8.1 MB           │          │
│  │ ⬇ 1,234 downloads     │  │ ⬇ 892 downloads        │          │
│  │ [Download] [♡]         │  │ [Download] [♡]         │          │
│  └────────────────────────┘  └────────────────────────┘          │
│                                                                  │
│  ── COLLECTIONS ─────────────────────────────────────────────    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ 📄 Campaign  │  │ 📋 Swipe     │  │ 📊 Case      │           │
│  │ Templates    │  │ Files        │  │ Studies      │           │
│  │ 24 resources │  │ 18 resources │  │ 12 resources │           │
│  │ [Browse →]   │  │ [Browse →]   │  │ [Browse →]   │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ 📝 SOPs      │  │ ⚡ Cheat     │  │ 🔒 Traffic   │           │
│  │              │  │ Sheets       │  │ Source Guides│           │
│  │ 8 resources  │  │ 15 resources │  │ Requires     │           │
│  │ [Browse →]   │  │ [Browse →]   │  │ Advanced     │           │
│  └──────────────┘  └──────────────┘  │ [Upgrade →]  │           │
│                                       └──────────────┘           │
│                                                                  │
│  ── RECENTLY ADDED ──────────────────────────────────────────    │
│  (list of newest resources)                                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5. Collection Browse Page (`/resources/:collectionSlug`)

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Resource Vault                                                │
│                                                                  │
│  📋 SWIPE FILES                                                  │
│  Proven examples of winning ads, headlines, and landing pages.   │
│                                                                  │
│  Sub-collections:                                                │
│  [🏆 Winning Headlines (34)] [📰 Advertorial Examples (12)]      │
│                                                                  │
│  [🔍 Search within collection..._____]  [All Types ▼] [Sort ▼]  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 📋 Top 50 Native Ad Headlines of 2026                    │    │
│  │ Curated winning headlines with CTR data and analysis.     │    │
│  │ PDF · 8.1 MB · ⬇ 892 · ♡ 234 · Updated Mar 2026        │    │
│  │ Tags: headlines, native-ads, swipe-file                   │    │
│  │ [Download] [Preview] [♡ Favorite]                         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ 📋 Health Niche Advertorial Breakdown                     │    │
│  │ Full analysis of a 6-figure advertorial campaign.         │    │
│  │ Article · ⬇ 567 · ♡ 189                                  │    │
│  │ Tags: advertorial, health, case-study                     │    │
│  │ [Read →] [♡ Favorite]                                     │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ...                                                             │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 6. Resource Detail Page (`/resources/:collectionSlug/:resourceId`)

Different layouts based on resource type:

**Downloadable files (template, swipe_file, cheat_sheet, tool, image_pack, guide):**
```
┌──────────────────────────────────────────────────────────────────┐
│  ← Swipe Files                                                   │
│                                                                  │
│  📋 Top 50 Native Ad Headlines of 2026          [♡] [⬇ Download]│
│  By BTS Team · Updated March 2026 · Version 3.0                 │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Preview image / first page of PDF]                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Curated collection of 50 proven native ad headlines from        │
│  2026 campaigns. Each headline includes: the full text, the      │
│  platform it ran on, estimated CTR range, and analysis of why    │
│  it worked.                                                      │
│                                                                  │
│  Format: PDF · Size: 8.1 MB                                     │
│  Downloads: 892 · Favorites: 234                                 │
│  Tags: headlines, native-ads, swipe-file, newsbreak              │
│                                                                  │
│  Related resources:                                              │
│  • Headline Writing Framework (Template)                         │
│  • Module 4: Content That Converts (Training)                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**In-portal articles (case_study, sop):**
```
[Same header]

[Full markdown content rendered in-portal with reading time estimate]
[Table of contents for long articles]
```

**Videos:**
```
[Same header]

[Embedded video player (Vimeo/Wistia)]
[Description below]
```

**Links:**
```
[Same header with prominent "Open Resource ↗" button]
[Description of what the external resource is and how to use it]
```

### 7. Favorites System

Members can favorite resources for quick access.

```sql
vault_favorites
  id              SERIAL PRIMARY KEY
  user_id         INTEGER REFERENCES users(id) NOT NULL
  resource_id     INTEGER REFERENCES vault_resources(id) NOT NULL
  created_at      TIMESTAMP DEFAULT NOW()
  UNIQUE(user_id, resource_id)
```

**UI:** Heart icon on every resource card. Filled when favorited. "Favorites" filter on the vault page shows only favorited resources. Optimistic UI toggle.

### 8. Search

Full-text search across resource titles, descriptions, tags, and content.

```sql
-- Add search vector to vault_resources
ALTER TABLE vault_resources ADD COLUMN search_vector TSVECTOR;
CREATE INDEX ON vault_resources USING GIN(search_vector);

-- Update trigger: rebuild vector on insert/update
-- Combines: title (weight A), tags (weight B), description (weight C), long_description (weight D)
```

**Search endpoint:**
```
GET /api/v1/resources?search=headline+testing&collection=swipe-files&type=template&sort=popular
```

Returns resources ranked by relevance, filtered by collection, type, and entitlement access.

### 9. Related Resources

Each resource can link to related resources (manual admin curation) and related training lessons.

```sql
vault_resource_relations
  id              SERIAL PRIMARY KEY
  resource_id     INTEGER REFERENCES vault_resources(id) NOT NULL
  related_type    TEXT NOT NULL              -- 'resource' or 'lesson'
  related_id      INTEGER NOT NULL           -- vault_resources.id or lessons.id
  sort_order      INTEGER DEFAULT 0
  UNIQUE(resource_id, related_type, related_id)
```

This creates cross-links between the vault and training system. A swipe file links to the lesson that teaches the concept. A case study links to the template used in the campaign.

### 10. Dashboard Widget

```
┌─ RESOURCE VAULT 📚 ─────────────────────────────────┐
│                                                      │
│  NEW: 50 Winning Headlines Swipe File (Mar 10)       │
│  NEW: NewsBreak Campaign Launch SOP (Mar 8)          │
│                                                      │
│  Your favorites: 12 saved resources                   │
│  [Browse Resource Vault →]                            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 11. Admin Panel

#### Resource Management (`/admin/resources`)

```
┌──────────────────────────────────────────────────────────────────┐
│  RESOURCE VAULT MANAGEMENT                    [+ Add Resource]   │
│                                                                  │
│  [All] [Templates] [Swipe Files] [Case Studies] [SOPs] [...]    │
│                                                                  │
│  Title              Collection    Type      Entitlement  Status  │
│  ────────────────────────────────────────────────────────────    │
│  50 Headlines        Swipe Files  swipe     frontend     Published│
│  Campaign Checklist  Templates    template  frontend     Published│
│  Health Case Study   Case Studies case      advanced     Draft   │
│                                                                  │
│  Actions: [Edit] [Preview] [Duplicate] [Archive] [Analytics]     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Add/Edit Resource:**
- Title, description, long description (rich text editor)
- Collection (dropdown with sub-collections)
- Resource type (dropdown)
- Tags (tag input with autocomplete from existing tags)
- Required entitlement (dropdown, null for all members)
- File upload (for downloadable types) → R2
- Preview image upload → R2
- Content HTML (for article types) → rich text editor
- External URL (for link types)
- Video URL (for video types)
- Related resources and lessons (search + select)
- Display flags: featured, pinned, new
- Version number and update note
- Status: draft, published, archived

**Collection management:** CRUD for collections and sub-collections.

**Resource analytics:**
- Most downloaded resources
- Most favorited resources
- Download trends over time
- Resources with no downloads (candidates for improvement or removal)
- Search queries with no results (content gap identification)

---

### 12. API Endpoints

```
# Member
GET    /api/v1/resources                          → List resources (filtered, searched, paginated)
GET    /api/v1/resources/collections               → List collections with counts
GET    /api/v1/resources/collections/:slug         → Collection detail with resources
GET    /api/v1/resources/:id                       → Resource detail
GET    /api/v1/resources/:id/download              → Download file (entitlement-checked, logged)
POST   /api/v1/resources/:id/favorite              → Toggle favorite
GET    /api/v1/resources/favorites                 → Member's favorited resources
GET    /api/v1/resources/search-suggestions        → Autocomplete for search

# Admin
CRUD   /api/v1/admin/resources                    → Manage resources
CRUD   /api/v1/admin/resource-collections          → Manage collections
POST   /api/v1/admin/resources/:id/upload          → Upload file
POST   /api/v1/admin/resources/:id/preview-image   → Upload preview image
CRUD   /api/v1/admin/resources/:id/relations       → Manage related resources
GET    /api/v1/admin/resources/analytics            → Vault analytics
GET    /api/v1/admin/resources/search-gaps          → Searches with no results
```

---

### 13. Seed Data

Seed 20–30 resources across collections:
- 5 templates (campaign plan, budget spreadsheet, tracking setup, headline framework, split test planner)
- 5 swipe files (winning headlines, ad copy examples, landing page examples)
- 3 case studies (health niche, finance niche, general scaling)
- 3 SOPs (campaign launch, optimization, compliance check)
- 4 cheat sheets (UTM parameters, platform policies, headline formulas, metrics definitions)
- 2 video tutorials (campaign setup walkthrough, tracking setup)
- 2 design asset packs (ad creative templates, banner templates)
- Use realistic placeholder content (500–2000 words for articles, actual PDF/XLSX files for downloads)

---

## Definition of Done

1. Resource vault page displays all resources organized by collection with search and filtering
2. Collection browse shows resources within a collection with sub-collection navigation
3. Resource detail page renders correctly for all 10 resource types
4. Downloadable resources check entitlements before allowing download
5. Full-text search works across titles, descriptions, tags, and content
6. Favorites toggle works with optimistic UI and persists across sessions
7. Entitlement gating shows locked collections/resources with upgrade CTA for unauthorized members
8. Admin can create, edit, organize, and archive resources without code changes
9. File uploads store in R2 with proper organization and preview image support
10. Related resources create cross-links between vault items and training lessons
11. Dashboard widget shows newly added resources and favorite count
12. Download and view counts tracked for analytics
13. Search gap analysis identifies what members are looking for but can't find
