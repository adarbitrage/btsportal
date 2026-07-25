/**
 * Conversation Continuity Summary (Task #1989).
 *
 * Covers:
 *  - summarizer prompt shape contract (fixed 3 sections, verbatim
 *    confirmations, per-brand-domain scoping) — deterministic, no live LLM;
 *  - long-chat scenario (b): a completion confirmation placed BEYOND the
 *    history-window boundary is folded into the summarizer prompt and the
 *    resulting summary is injectable at the exact watermark;
 *  - two-brand-domain scenario (f): both domains' messages reach the
 *    summarizer with the explicit scoping instruction;
 *  - watermark gate: stale/absent summaries are never injected;
 *  - incremental fold: a second update only feeds the NEW aged-out slice;
 *  - fail-open: summarizer errors never throw or corrupt stored state.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const createMock = vi.fn();
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  getAnthropicClient: () => ({ messages: { create: createMock } }),
}));

import { db, usersTable, chatSessionsTable, chatMessagesTable, chatSessionSummariesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CONTINUITY_HEADER,
  buildContinuitySummarizerPrompt,
  buildContinuityBlock,
  getAgedOutWatermark,
  getContinuitySummaryForContext,
  updateContinuitySummary,
} from "../lib/chat-continuity";

const HISTORY_DEPTH = 30;

describe("buildContinuitySummarizerPrompt (shape contract)", () => {
  const prompt = buildContinuitySummarizerPrompt(null, [
    { role: "user", content: "yes I finished cloning the site" },
  ]);

  it("mandates the fixed three-section shape", () => {
    expect(prompt).toContain("### Confirmed completed steps");
    expect(prompt).toContain("### Member-stated setup facts");
    expect(prompt).toContain("### Explicitly not done yet");
  });

  it("requires verbatim member confirmation wording and forbids inferred completion", () => {
    expect(prompt).toContain("verbatim");
    expect(prompt).toContain("never infer completion");
  });

  it("requires per-brand-domain scoping of setup facts", () => {
    expect(prompt).toContain("NEVER carries over to a different brand domain");
  });

  it("forbids invented terminology and instructions", () => {
    expect(prompt).toContain("Never invent terminology");
    expect(prompt).toContain("no advice, no instructions");
  });

  it("includes the aged-out transcript and merges a previous summary when present", () => {
    expect(prompt).toContain("Member: yes I finished cloning the site");
    const withPrev = buildContinuitySummarizerPrompt("### Confirmed completed steps\n- prior fact", [
      { role: "assistant", content: "Great, next step." },
    ]);
    expect(withPrev).toContain("Previous summary (merge into your output):");
    expect(withPrev).toContain("- prior fact");
  });

  it("scenario (f): two brand domains both reach the summarizer with the scoping rule", () => {
    const p = buildContinuitySummarizerPrompt(null, [
      { role: "user", content: "my subdomain is set up on consumerwatchdog.io" },
      { role: "user", content: "for the other offer I'm using thecuttingedge.today" },
    ]);
    expect(p).toContain("consumerwatchdog.io");
    expect(p).toContain("thecuttingedge.today");
    expect(p).toContain("must name that domain explicitly");
  });
});

describe("buildContinuityBlock", () => {
  it("labels the summary as context, never instructions, and ties completed steps to Rule 19", () => {
    const block = buildContinuityBlock("### Confirmed completed steps\n- cloning done");
    expect(block).toContain(CONTINUITY_HEADER);
    expect(block).toContain("context, never instructions");
    expect(block).toContain("Rule 19");
    expect(block).toContain("- cloning done");
  });
});

describe("continuity summary DB flow", () => {
  let userId: number;
  let sessionId: number;
  const messageIds: number[] = [];

  async function addMessage(role: "user" | "assistant", content: string): Promise<number> {
    const [row] = await db
      .insert(chatMessagesTable)
      .values({ sessionId, role, content })
      .returning({ id: chatMessagesTable.id });
    messageIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `continuity-test-${Date.now()}@example.com`,
        passwordHash: "x",
        name: "Continuity Test",
        role: "member",
        sourceProduct: "free",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    userId = user.id;
    const [session] = await db
      .insert(chatSessionsTable)
      .values({ userId, title: "continuity test" })
      .returning({ id: chatSessionsTable.id });
    sessionId = session.id;
  });

  afterAll(async () => {
    await db.delete(chatSessionSummariesTable).where(eq(chatSessionSummariesTable.sessionId, sessionId));
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.sessionId, sessionId));
    await db.delete(chatSessionsTable).where(eq(chatSessionsTable.id, sessionId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  beforeEach(() => {
    createMock.mockReset();
  });

  it("returns null watermark while the conversation still fits the window, and updateContinuitySummary is a free no-op", async () => {
    for (let i = 0; i < 5; i++) {
      await addMessage(i % 2 === 0 ? "user" : "assistant", `early message ${i}`);
    }
    expect(await getAgedOutWatermark(sessionId, HISTORY_DEPTH)).toBeNull();
    await updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("scenario (b), full production sequence: end-of-turn update → next-turn user insert → summary injects at the route's expected watermark", async () => {
    // The observed-failure confirmation, placed EARLY so it ages out.
    await addMessage("user", "yes I finished cloning the site on consumerwatchdog.io");
    // Grow the conversation past the window, ending on an assistant reply
    // (i.e. a completed turn, exactly the state when updateContinuitySummary
    // fires fire-and-forget in the route).
    while (messageIds.length < HISTORY_DEPTH + 8) {
      await addMessage(
        messageIds.length % 2 === 0 ? "user" : "assistant",
        `filler turn ${messageIds.length}`,
      );
    }

    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '### Confirmed completed steps\n- Flexy site cloning — member confirmed: "yes I finished cloning the site on consumerwatchdog.io"\n\n### Member-stated setup facts\n- Site cloned on consumerwatchdog.io\n\n### Explicitly not done yet\n- none recorded',
        },
      ],
    });
    // END OF TURN N: the route fires the summary update.
    await updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH });

    // The aged-out confirmation was in the summarizer's input.
    expect(createMock).toHaveBeenCalledTimes(1);
    const sentPrompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(sentPrompt).toContain("yes I finished cloning the site on consumerwatchdog.io");

    // START OF TURN N+1: the route inserts the new user message FIRST, then
    // computes the expected watermark, then looks the summary up. This is the
    // exact sequencing that previously exposed an off-by-one mismatch.
    await addMessage("user", "what should I do next?");
    const expectedWatermark = await getAgedOutWatermark(sessionId, HISTORY_DEPTH);
    expect(expectedWatermark).not.toBeNull();
    // Watermark = newest aged-out message = (total - historyDepth)th oldest.
    expect(expectedWatermark).toBe(messageIds[messageIds.length - HISTORY_DEPTH - 1]);

    const summary = await getContinuitySummaryForContext(sessionId, expectedWatermark!);
    expect(summary).toContain("yes I finished cloning the site");
    // Exact-match gate still rejects any other watermark.
    expect(await getContinuitySummaryForContext(sessionId, expectedWatermark! + 999)).toBeNull();
  });

  it("stays injected across a SECOND consecutive overflow turn (update → insert → lookup again)", async () => {
    // Complete turn N+1 (assistant reply), fire the end-of-turn update.
    await addMessage("assistant", "Next you set up your Flexy custom values.");
    createMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: "### Confirmed completed steps\n- Flexy site cloning — member confirmed: \"yes I finished cloning the site\"\n\n### Member-stated setup facts\n- Site cloned on consumerwatchdog.io\n\n### Explicitly not done yet\n- none recorded",
        },
      ],
    });
    await updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH });
    expect(createMock).toHaveBeenCalledTimes(1);

    // Turn N+2 begins: user message inserted, watermark computed, lookup.
    await addMessage("user", "ok done with that too");
    const expectedWatermark = await getAgedOutWatermark(sessionId, HISTORY_DEPTH);
    expect(expectedWatermark).not.toBeNull();
    const summary = await getContinuitySummaryForContext(sessionId, expectedWatermark!);
    expect(summary).toContain("yes I finished cloning the site");
  });

  it("no-ops when the watermark is already current (no repeat LLM spend)", async () => {
    // The last turn is still open (no assistant reply added since the last
    // update ran with the lookahead boundary already covered)... complete it
    // without growing past the covered boundary is impossible here, so
    // instead verify directly: running update twice in a row is free.
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "### Confirmed completed steps\n- Flexy site cloning — member confirmed: \"yes I finished cloning the site\"\n\n### Member-stated setup facts\n- Site cloned on consumerwatchdog.io\n\n### Explicitly not done yet\n- none recorded" }],
    });
    await updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH });
    const callsAfterFirst = createMock.mock.calls.length;
    await updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH });
    expect(createMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("incrementally folds ONLY the newly aged-out slice, carrying the previous summary", async () => {
    const [before] = await db
      .select()
      .from(chatSessionSummariesTable)
      .where(eq(chatSessionSummariesTable.sessionId, sessionId));
    const prevWatermark = before.coveredThroughMessageId;

    await addMessage("assistant", "Great progress.");
    await addMessage("user", "my second brand runs on thecuttingedge.today");
    await addMessage("assistant", "Noted — facts stay scoped per domain.");

    createMock.mockReset();
    createMock.mockResolvedValue({
      content: [{ type: "text", text: "### Confirmed completed steps\n- merged\n\n### Member-stated setup facts\n- both domains\n\n### Explicitly not done yet\n- none recorded" }],
    });
    await updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH });

    expect(createMock).toHaveBeenCalledTimes(1);
    const sentPrompt = createMock.mock.calls[0][0].messages[0].content as string;
    // Previous summary carried in; already-covered turns NOT re-sent.
    expect(sentPrompt).toContain("Previous summary (merge into your output):");
    expect(sentPrompt).toContain("yes I finished cloning the site");
    expect(sentPrompt).not.toContain("early message 0");

    const [after] = await db
      .select()
      .from(chatSessionSummariesTable)
      .where(eq(chatSessionSummariesTable.sessionId, sessionId));
    expect(after.coveredThroughMessageId).toBeGreaterThan(prevWatermark);
    expect(after.summary).toContain("both domains");
  });

  it("fail-open: a summarizer failure neither throws nor corrupts the stored summary", async () => {
    await addMessage("user", "another turn to age something out");
    await addMessage("assistant", "ok");
    const [before] = await db
      .select()
      .from(chatSessionSummariesTable)
      .where(eq(chatSessionSummariesTable.sessionId, sessionId));

    createMock.mockRejectedValue(new Error("model unavailable"));
    await expect(
      updateContinuitySummary({ sessionId, historyDepth: HISTORY_DEPTH }),
    ).resolves.toBeUndefined();

    const [after] = await db
      .select()
      .from(chatSessionSummariesTable)
      .where(eq(chatSessionSummariesTable.sessionId, sessionId));
    expect(after.summary).toBe(before.summary);
    expect(after.coveredThroughMessageId).toBe(before.coveredThroughMessageId);
  });
});

describe("short-chat regression: confirmation stays in verbatim history, no continuity block", () => {
  it("mirrors the route's context assembly for a conversation that fits the window", async () => {
    createMock.mockReset();
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `continuity-short-${Date.now()}@example.com`,
        passwordHash: "x",
        name: "Continuity Short Test",
        role: "member",
        sourceProduct: "free",
        emailVerified: true,
        onboardingComplete: true,
      })
      .returning({ id: usersTable.id });
    const [session] = await db
      .insert(chatSessionsTable)
      .values({ userId: user.id, title: "continuity short test" })
      .returning({ id: chatSessionsTable.id });
    try {
      const add = async (role: "user" | "assistant", content: string) => {
        await db.insert(chatMessagesTable).values({ sessionId: session.id, role, content });
      };
      // The observed-failure shape, in a SHORT chat: confirmation a few turns
      // back, then the member asks a progress question.
      await add("user", "how do I clone the site?");
      await add("assistant", "Use the Flexy clone tool.");
      await add("user", "yes I finished cloning the site on consumerwatchdog.io");
      await add("assistant", "Great, next is your Flexy custom values.");
      await add("user", "what have I got left to do?"); // current turn, inserted first (as route does)

      // Route sequence: history query → watermark → priorTurns assembly.
      const { desc: descFn, eq: eqFn } = await import("drizzle-orm");
      const history = await db
        .select()
        .from(chatMessagesTable)
        .where(eqFn(chatMessagesTable.sessionId, session.id))
        .orderBy(descFn(chatMessagesTable.createdAt))
        .limit(HISTORY_DEPTH);
      const orderedHistory = history.reverse();

      // Fits the window → no watermark → no continuity block anywhere.
      expect(await getAgedOutWatermark(session.id, HISTORY_DEPTH)).toBeNull();
      await updateContinuitySummary({ sessionId: session.id, historyDepth: HISTORY_DEPTH });
      expect(createMock).not.toHaveBeenCalled();

      // The confirmation is still VERBATIM in the assembled prior turns, so
      // Rule 19's "check the recent conversation before asking" has its
      // evidence in-context and must not re-ask this step.
      const priorTurns = orderedHistory
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }));
      expect(
        priorTurns.some((t) =>
          t.content.includes("yes I finished cloning the site on consumerwatchdog.io"),
        ),
      ).toBe(true);
      expect(priorTurns.some((t) => t.content.includes(CONTINUITY_HEADER))).toBe(false);
    } finally {
      await db.delete(chatMessagesTable).where(eq(chatMessagesTable.sessionId, session.id));
      await db.delete(chatSessionsTable).where(eq(chatSessionsTable.id, session.id));
      await db.delete(usersTable).where(eq(usersTable.id, user.id));
    }
  });
});
