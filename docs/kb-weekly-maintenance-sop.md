# Weekly Knowledge Base Maintenance SOP

**Audience:** Any BTS admin  
**Cadence:** Once per week (recommended: Monday or Tuesday)  
**Time required:** ~15–30 minutes for a healthy queue; longer if backlog has built up

---

## How the Auto-Triage System Works

New KB documents (generated from coaching calls, Blitz content, etc.) land in a **staging area** and are automatically scored by AI before a human ever sees them.

| AI outcome | What happens automatically | What you do |
|---|---|---|
| High-confidence approve (≥ 85 %) | Document auto-approved and queued for push | Nothing — just verify in the audit log if you want |
| Low-confidence reject (≤ 20 %) | Document auto-rejected | Nothing — optionally audit and undo if wrong |
| In-between | Document flagged as **`needs_review`** | **This is your weekly job** |

**Your only recurring task is clearing the `needs_review` queue.** Everything else is handled automatically.

> **Note:** Pushed documents go live to the AI assistant immediately — no server restart is required.

---

## Weekly Routine (Checklist)

### 1. Navigate to Document Review

Admin panel → **Knowledge Base** → **Document Review**

### 2. Check the triage status banner

- If AI triage is still running (spinner visible), wait for it to finish before reviewing.
- If new `pending_review` documents have arrived since last week, click **Run AI Triage** to score them before you start. The button is in the top-right of the Document Review page.

### 3. Clear the `needs_review` queue

- Click **Review Queue** (shows the count, e.g. "Review Queue (12)") to enter guided review mode. Alternatively, filter the table to `needs_review` and work through docs manually.
- In guided review mode, each document is shown one at a time with the AI's recommendation and confidence score visible.
- For each document:
  - [ ] Read the title and content.
  - [ ] Accept the AI recommendation → press **A** (approve) or **R** (reject), or use the buttons.
  - [ ] If the content is good but needs minor edits → press **E** to edit inline, then save (edit auto-approves).
  - [ ] If two documents cover the same topic → select both in the list view and use **Merge**.
- Continue until the queue shows "Review Queue Complete."

**Keyboard shortcuts in guided mode:** `A` = approve · `R` = reject · `E` = edit · `→` / `N` = next · `←` / `P` = previous

### 4. Push approved documents live

After clearing the review queue:

- [ ] Click **Push N to KB** (e.g. "Push 8 to KB") in the top-right of Document Review. This pushes all approved docs — both human-approved from step 3 and any auto-approved by AI triage — in one shot.
- Confirm the count looks reasonable.
- Pushed documents are immediately available to the AI assistant — no restart needed.

### 5. Spot-check the assistant

- [ ] Open the member-facing AI chat.
- [ ] Ask one or two questions related to content you just pushed (e.g. a topic from this week's coaching call).
- [ ] Confirm the assistant answers correctly and cites the new material.
- If the answer is wrong or missing, return to **Knowledge Base → Live Documents**, find the doc, and edit it directly.

### 6. Quick audit (optional, ~2 min)

- On Document Review, click **View Audit Log** to see what the AI approved or rejected automatically this week (the dialog is titled "AI Auto-action Audit Log").
- If any auto-action looks wrong, click **Undo** to move the document back to `needs_review` and handle it manually.

---

## Managing Live Documents

Go to **Knowledge Base → Live Documents** to:

- **Search / filter** existing docs by category or keyword.
- **Edit** a live doc — click the pencil icon, update the content, and save. Changes are live immediately.
- **Add** a new doc manually — click **Add Document**, fill in title, category, and content, then save.
- **Delete** a doc — click the trash icon and confirm. Removal is immediate.

Categories available: FAQ · Platform Guide · Marketing · Compliance · Advanced Strategy · Troubleshooting

---

## One-Time Backlog Cleanup

If the staging area has accumulated a large `pending_review` or `needs_review` pile (e.g. after first setup, or after a period of no maintenance):

1. **Run AI Triage first** — this will auto-handle the majority of documents and shrink the human queue dramatically. Wait for the triage run to complete.
2. Check the `needs_review` count. If it is still large (> 50), work through it in sessions:
   - Use guided review mode — it is faster than the table view.
   - Prioritize by source: coaching call content is usually higher quality; blitz content may need more edits.
3. After each session, push what you have approved so content goes live incrementally.
4. Repeat daily until the backlog is clear, then drop back to the weekly cadence.

---

## Adjusting AI Triage Thresholds (Admin Only)

If the AI is auto-approving too aggressively or sending too many docs to human review, click the **⚙ Settings** icon on the Document Review page:

- **Auto-approve threshold** — raise to be more conservative (fewer auto-approvals), lower to approve more automatically. Default: 85 %.
- **Auto-reject threshold** — raise to reject more aggressively, lower to send more to human review. Default: 20 %.

Save and re-run triage for the change to take effect on existing pending docs.

---

## Quick Reference

| Where to go | What for |
|---|---|
| Admin → Knowledge Base → Document Review | Review staging queue, run triage, push approved docs |
| Admin → Knowledge Base → Live Documents | View, edit, add, or delete live KB articles |
| Document Review → Auto-Action Audit Log | See what AI approved/rejected automatically; undo if needed |
| Document Review → ⚙ Settings | Adjust auto-approve / auto-reject confidence thresholds |
