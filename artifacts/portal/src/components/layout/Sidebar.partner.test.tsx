import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARTNER_NAV_NODES, shouldShowPartnerSection } from "./Sidebar";
import type { NavLeaf } from "./sidebar-nav";

const APP_TSX_PATH = path.resolve(__dirname, "..", "..", "App.tsx");
const APP_TSX = readFileSync(APP_TSX_PATH, "utf8");

describe("App.tsx partner route", () => {
  it('registers a <Route path="/partner"> in App.tsx', () => {
    expect(APP_TSX).toContain('path="/partner"');
  });

  it("guards the partner route with the PartnerRoute component", () => {
    expect(APP_TSX).toContain("PartnerRoute");
  });
});

describe("Sidebar PARTNER_NAV_NODES", () => {
  it("contains a Partner Home leaf pointing at /partner", () => {
    const leaf = PARTNER_NAV_NODES.find(
      (n): n is NavLeaf => n.kind === "leaf" && n.href === "/partner",
    );
    expect(leaf).toBeDefined();
  });
});

describe("Sidebar shouldShowPartnerSection role visibility", () => {
  it("shows the Partner section when the auth user is a partner", () => {
    expect(shouldShowPartnerSection("partner", "free_member")).toBe(true);
  });

  it("shows the Partner section when the member profile is a partner", () => {
    expect(shouldShowPartnerSection("free_member", "partner")).toBe(true);
  });

  it("shows the Partner section for an admin role with partners:view", () => {
    expect(shouldShowPartnerSection("super_admin", "free_member")).toBe(true);
    expect(shouldShowPartnerSection("free_member", "admin")).toBe(true);
    expect(shouldShowPartnerSection("support_agent", "free_member")).toBe(true);
  });

  it("hides the Partner section for a plain member", () => {
    expect(shouldShowPartnerSection("free_member", "free_member")).toBe(false);
    expect(shouldShowPartnerSection(undefined, undefined)).toBe(false);
  });

  it("hides the Partner section for a coach (coach and partner sections are independent)", () => {
    expect(shouldShowPartnerSection("coach", "free_member")).toBe(false);
  });

  it("hides the Partner section for an admin role that lacks partners:view", () => {
    // content_manager is an admin role but does not have partners:view.
    expect(shouldShowPartnerSection("content_manager", "free_member")).toBe(false);
  });
});
