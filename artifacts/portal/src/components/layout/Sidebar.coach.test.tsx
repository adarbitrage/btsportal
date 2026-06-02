import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COACH_NAV_NODES, shouldShowCoachSection } from "./Sidebar";
import type { NavLeaf } from "./sidebar-nav";

const APP_TSX_PATH = path.resolve(__dirname, "..", "..", "App.tsx");
const APP_TSX = readFileSync(APP_TSX_PATH, "utf8");

describe("App.tsx coach routes", () => {
  const expectedRoutes = ["/coach/dashboard", "/coach/mentees/:userId"];

  for (const route of expectedRoutes) {
    it(`registers a <Route path="${route}"> in App.tsx`, () => {
      expect(APP_TSX).toContain(`path="${route}"`);
    });
  }

  it("guards the coach routes with the CoachRoute component", () => {
    expect(APP_TSX).toContain("CoachRoute");
  });
});

describe("Sidebar COACH_NAV_NODES", () => {
  it("contains the Mentee Progress leaf pointing at /coach/dashboard", () => {
    const labels = COACH_NAV_NODES.map((n) => n.label);
    expect(labels).toEqual(["Mentee Progress"]);

    const leaf = COACH_NAV_NODES.find(
      (n): n is NavLeaf => n.kind === "leaf" && n.label === "Mentee Progress",
    );
    expect(leaf).toBeDefined();
    expect(leaf!.href).toBe("/coach/dashboard");
  });
});

describe("Sidebar shouldShowCoachSection role visibility", () => {
  it("shows the Coach section when the auth user is a coach", () => {
    expect(shouldShowCoachSection("coach", "free_member")).toBe(true);
  });

  it("shows the Coach section when the member profile is a coach", () => {
    expect(shouldShowCoachSection("free_member", "coach")).toBe(true);
  });

  it("shows the Coach section for an admin role with coaching:view", () => {
    expect(shouldShowCoachSection("super_admin", "free_member")).toBe(true);
    expect(shouldShowCoachSection("free_member", "admin")).toBe(true);
  });

  it("hides the Coach section for a plain member", () => {
    expect(shouldShowCoachSection("free_member", "free_member")).toBe(false);
    expect(shouldShowCoachSection(undefined, undefined)).toBe(false);
  });

  it("hides the Coach section for an admin role that lacks coaching:view", () => {
    // support_agent is an admin role but does not have coaching:view.
    expect(shouldShowCoachSection("support_agent", "free_member")).toBe(false);
  });
});
