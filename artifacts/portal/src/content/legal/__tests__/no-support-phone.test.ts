import { describe, expect, it } from "vitest";

// The support phone number 1-888-996-5513 was removed from the portal.
// Guard that no legal content export reintroduces it.
const PHONE = ["1-888", "996-5513"].join("-");

describe("legal content contains no support phone number", () => {
  it("no legal content module exports the removed phone number", async () => {
    const modules = import.meta.glob("../*.ts", { eager: true }) as Record<
      string,
      Record<string, unknown>
    >;
    const paths = Object.keys(modules);
    expect(paths.length).toBeGreaterThan(0);
    for (const [path, mod] of Object.entries(modules)) {
      for (const [key, value] of Object.entries(mod)) {
        if (typeof value === "string") {
          expect(value.includes(PHONE), `${path}#${key} contains ${PHONE}`).toBe(false);
        }
      }
    }
  });
});
