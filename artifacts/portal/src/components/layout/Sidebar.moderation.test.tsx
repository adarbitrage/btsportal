import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_CHILDREN } from "./Sidebar";
import type { NavFolder, NavLeaf } from "./sidebar-nav";

const APP_TSX_PATH = path.resolve(__dirname, "..", "..", "App.tsx");
const APP_TSX = readFileSync(APP_TSX_PATH, "utf8");

describe("App.tsx moderation routes", () => {
  const expectedRoutes = [
    "/admin/moderation/queue",
    "/admin/moderation/ai-flagged",
    "/admin/moderation/wordlist",
    "/admin/moderation/strikes",
    "/admin/moderation/strikes/:userId",
  ];

  for (const route of expectedRoutes) {
    it(`registers a <Route path="${route}"> in App.tsx`, () => {
      expect(APP_TSX).toContain(`path="${route}"`);
    });
  }
});

describe("Sidebar ADMIN_CHILDREN moderation folder", () => {
  const moderationFolder = ADMIN_CHILDREN.find(
    (node): node is NavFolder =>
      node.kind === "folder" && node.label === "Moderation",
  );

  it("contains a Moderation folder", () => {
    expect(moderationFolder).toBeDefined();
  });

  it("has Queue, AI Flagged, Wordlist, and Strikes leaf children in that order", () => {
    expect(moderationFolder).toBeDefined();
    const labels = moderationFolder!.children.map((c) => c.label);
    expect(labels).toEqual(["Queue", "AI Flagged", "Wordlist", "Strikes"]);
  });

  it("each child is a leaf with the expected admin moderation href", () => {
    expect(moderationFolder).toBeDefined();
    const byLabel = new Map(
      moderationFolder!.children.map((c) => [c.label, c as NavLeaf]),
    );
    expect(byLabel.get("Queue")?.href).toBe("/admin/moderation/queue");
    expect(byLabel.get("AI Flagged")?.href).toBe("/admin/moderation/ai-flagged");
    expect(byLabel.get("Wordlist")?.href).toBe("/admin/moderation/wordlist");
    expect(byLabel.get("Strikes")?.href).toBe("/admin/moderation/strikes");
    for (const child of moderationFolder!.children) {
      expect(child.kind).toBe("leaf");
    }
  });

  it("Queue leaf has showModerationBadge set to true", () => {
    expect(moderationFolder).toBeDefined();
    const queue = moderationFolder!.children.find(
      (c) => c.label === "Queue",
    ) as NavLeaf | undefined;
    expect(queue).toBeDefined();
    expect(queue!.showModerationBadge).toBe(true);
  });

  it("non-Queue leaves do not opt into the moderation badge", () => {
    expect(moderationFolder).toBeDefined();
    for (const child of moderationFolder!.children) {
      if (child.kind !== "leaf") continue;
      if (child.label === "Queue") continue;
      expect(child.showModerationBadge ?? false).toBe(false);
    }
  });
});
