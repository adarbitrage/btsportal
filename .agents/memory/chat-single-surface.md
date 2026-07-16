---
name: Single member chat surface
description: /ai-assistant is the ONE member AI chat surface; legacy /api/ai-chat stack deleted
---
- `/ai-assistant` page is the sole member AI chat surface, on the modern `/api/chat` backend (Claude SSE, retrieveSurfaceAware, DB sentinel prompt, chat_sessions/chat_messages). Floating ChatWidget retired; `/chat` redirects.
- Legacy `/api/ai-chat` GPT-5 stack (getSystemPrompt hardcoded facts, ALL_KB_CATEGORIES, searchTranscripts, reloadKnowledgeBase) DELETED; legacy conversations/messages tables dropped via 0118 migration + post-merge hook. Do not resurrect.
- Tier gating removed: chat access is binary, one global daily limit (100). No chat:basic/full/custom.
- **Why:** legacy retrieval was dead (category list matched zero ai_live_documents rows), answers came from stale hardcoded facts.
- Trap: KB push pipeline sets live-doc category = home-root slug (NOT "faq"); retrieval-probe tests must scope categories to the pushed row's own category and mark it citable (docClass curated + lastVerified).
