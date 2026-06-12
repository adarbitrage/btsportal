/**
 * Unit-level contract for `canDM` — the single source of truth for which
 * (senderRole, recipientRole) DM pairs are permitted.
 *
 * The sibling dm-permissions.test.ts exercises the HTTP layer end-to-end; this
 * file pins the pure function for *every* role-pair combination so any future
 * accidental breakage is caught in one fast, DB-free place.
 */
import { describe, it, expect } from "vitest";
import { ADMIN_ROLES } from "@workspace/auth";
import { canDM } from "../middleware/dmPermissions";

const MEMBER = "member";
const COACH = "coach";

describe("canDM — explicit role-pair contract", () => {
  const cases: Array<[string, string, boolean]> = [
    // The non-negotiable guarantee.
    [MEMBER, MEMBER, false],
    // Member ↔ coach (new behaviour, both directions).
    [MEMBER, COACH, true],
    [COACH, MEMBER, true],
    // Member ↔ admin (existing behaviour, both directions).
    [MEMBER, "admin", true],
    ["admin", MEMBER, true],
    // Coach ↔ admin is not intended.
    [COACH, "admin", false],
    ["admin", COACH, false],
    // Coach ↔ coach is forbidden.
    [COACH, COACH, false],
  ];

  it.each(cases)("canDM(%s, %s) === %s", (sender, recipient, expected) => {
    expect(canDM(sender, recipient)).toBe(expected);
  });
});

describe("canDM — every admin role can DM a member (both directions)", () => {
  it.each([...ADMIN_ROLES])("member ↔ %s is permitted", (adminRole) => {
    expect(canDM(MEMBER, adminRole)).toBe(true);
    expect(canDM(adminRole, MEMBER)).toBe(true);
  });

  it.each([...ADMIN_ROLES])("coach ↔ %s is forbidden", (adminRole) => {
    expect(canDM(COACH, adminRole)).toBe(false);
    expect(canDM(adminRole, COACH)).toBe(false);
  });

  it.each([...ADMIN_ROLES])(
    "admin role pairs (%s ↔ each other) are forbidden",
    (adminRole) => {
      for (const other of ADMIN_ROLES) {
        expect(canDM(adminRole, other)).toBe(false);
      }
    }
  );
});

describe("canDM — exhaustive matrix over all known roles", () => {
  const roles = [MEMBER, COACH, ...ADMIN_ROLES];

  // A pair is permitted iff exactly one side is a member and the other side is
  // a coach or an admin role. This mirrors the production rules independently.
  const isAdmin = (r: string) => (ADMIN_ROLES as readonly string[]).includes(r);
  const expectedAllowed = (a: string, b: string): boolean => {
    if (a === MEMBER && (b === COACH || isAdmin(b))) return true;
    if (b === MEMBER && (a === COACH || isAdmin(a))) return true;
    return false;
  };

  for (const a of roles) {
    for (const b of roles) {
      it(`canDM(${a}, ${b})`, () => {
        expect(canDM(a, b)).toBe(expectedAllowed(a, b));
      });
    }
  }
});

describe("canDM — unknown roles are always rejected", () => {
  it("rejects unknown sender and recipient roles", () => {
    expect(canDM("guest", "member")).toBe(false);
    expect(canDM("member", "guest")).toBe(false);
    expect(canDM("guest", "guest")).toBe(false);
    expect(canDM("", "")).toBe(false);
  });
});
