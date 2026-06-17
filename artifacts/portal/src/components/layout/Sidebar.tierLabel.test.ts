import { describe, expect, it } from "vitest";
import {
  getSidebarTierLabel,
  getStaffLabel,
  resolveAdminRole,
  shouldShowUpgradeCard,
} from "./sidebar-nav";

describe("getStaffLabel", () => {
  it("returns 'Super Admin' for the super_admin role", () => {
    expect(getStaffLabel("super_admin")).toBe("Super Admin");
  });

  it("returns 'Admin' for every other admin role", () => {
    expect(getStaffLabel("admin")).toBe("Admin");
    expect(getStaffLabel("support_agent")).toBe("Admin");
    expect(getStaffLabel("content_manager")).toBe("Admin");
  });
});

describe("getSidebarTierLabel staff vs member", () => {
  it("shows 'Super Admin' for a super_admin and never 'Free Member'", () => {
    const label = getSidebarTierLabel({
      isAdminUser: true,
      userRole: "super_admin",
      // Staff often have no purchased products, so the slug is "free".
      highestProductSlug: "free",
    });
    expect(label).toBe("Super Admin");
    expect(label).not.toBe("Free Member");
  });

  it("shows 'Admin' for a non-super admin role and never 'Free Member'", () => {
    for (const role of ["admin", "support_agent", "content_manager"]) {
      const label = getSidebarTierLabel({
        isAdminUser: true,
        userRole: role,
        highestProductSlug: "free",
      });
      expect(label).toBe("Admin");
      expect(label).not.toBe("Free Member");
    }
  });

  it("shows 'Free Member' for a genuine free member", () => {
    expect(
      getSidebarTierLabel({
        isAdminUser: false,
        userRole: "free_member",
        highestProductSlug: "free",
      }),
    ).toBe("Free Member");
  });

  it("shows 'Coach' for a coach and never a product tier", () => {
    // A coach holds no purchased products (empty entitlements / "free" slug)
    // but must read as "Coach", not "Free Member".
    const label = getSidebarTierLabel({
      isAdminUser: false,
      userRole: "coach",
      highestProductSlug: "free",
    });
    expect(label).toBe("Coach");
    expect(label).not.toBe("Free Member");
  });

  it("derives a paying member's label from highestProductSlug", () => {
    expect(
      getSidebarTierLabel({
        isAdminUser: false,
        userRole: "lifetime_member",
        highestProductSlug: "lifetime",
      }),
    ).toBe("Lifetime Member");

    expect(
      getSidebarTierLabel({
        isAdminUser: false,
        userRole: "member",
        highestProductSlug: "3month",
      }),
    ).toBe("3-Month Mentorship");

    expect(
      getSidebarTierLabel({
        isAdminUser: false,
        userRole: "member",
        highestProductSlug: "frontend",
      }),
    ).toBe("Front-End Member");
  });

  it("ignores userRole for the label when the user is not an admin", () => {
    // For non-admins the label comes purely from the product slug, never the
    // role string — guarding against re-deriving the tier from a role/source
    // field instead of highestProductSlug.
    expect(
      getSidebarTierLabel({
        isAdminUser: false,
        userRole: "super_admin",
        highestProductSlug: "launchpad",
      }),
    ).toBe("LaunchPad Member");
  });
});

describe("shouldShowUpgradeCard", () => {
  it("hides the upgrade card for admins/staff", () => {
    expect(shouldShowUpgradeCard(true)).toBe(false);
  });

  it("shows the upgrade card for non-admin members", () => {
    expect(shouldShowUpgradeCard(false)).toBe(true);
  });

  it("hides the upgrade card for coaches (staff, never upsell targets)", () => {
    expect(shouldShowUpgradeCard(false, true)).toBe(false);
    // Admin OR coach both suppress it.
    expect(shouldShowUpgradeCard(true, true)).toBe(false);
  });

  it("still shows the upgrade card for a plain member (isCoach=false)", () => {
    expect(shouldShowUpgradeCard(false, false)).toBe(true);
  });
});

describe("sidebar staff label + upgrade card wiring (end to end via resolveAdminRole)", () => {
  function sidebarStateFor(params: {
    authRole: string | undefined | null;
    memberRole: string | undefined | null;
    highestProductSlug: string | undefined | null;
  }) {
    const { userRole, isAdminUser } = resolveAdminRole(
      params.authRole,
      params.memberRole,
    );
    return {
      label: getSidebarTierLabel({
        isAdminUser,
        userRole,
        highestProductSlug: params.highestProductSlug,
      }),
      showsUpgradeCard: shouldShowUpgradeCard(isAdminUser),
    };
  }

  it("a super_admin sees 'Super Admin' and no upgrade card", () => {
    const state = sidebarStateFor({
      authRole: "super_admin",
      memberRole: "free_member",
      highestProductSlug: "free",
    });
    expect(state.label).toBe("Super Admin");
    expect(state.showsUpgradeCard).toBe(false);
  });

  it("an admin sees 'Admin' and no upgrade card", () => {
    const state = sidebarStateFor({
      authRole: "admin",
      memberRole: "free_member",
      highestProductSlug: "free",
    });
    expect(state.label).toBe("Admin");
    expect(state.showsUpgradeCard).toBe(false);
  });

  it("a genuine free member sees 'Free Member' and the upgrade card", () => {
    const state = sidebarStateFor({
      authRole: "free_member",
      memberRole: "free_member",
      highestProductSlug: "free",
    });
    expect(state.label).toBe("Free Member");
    expect(state.showsUpgradeCard).toBe(true);
  });

  it("a paying member sees their product tier and the upgrade card", () => {
    const state = sidebarStateFor({
      authRole: "member",
      memberRole: "member",
      highestProductSlug: "6month",
    });
    expect(state.label).toBe("6-Month Mentorship");
    expect(state.showsUpgradeCard).toBe(true);
  });
});
