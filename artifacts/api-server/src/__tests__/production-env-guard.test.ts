import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  evaluateProductionEnvGuards,
  getMisconfiguredCriticalSecrets,
  GUARDED_SECRETS,
  isSecretMisconfigured,
  __resetProductionEnvGuardForTests,
  __setProductionEnvGuardDeliveriesForTests,
  type DeliveryResult,
  type ProductionEnvGuardAlertPayload,
} from "../lib/production-env-guard";

interface StubChannel {
  fn: (p: ProductionEnvGuardAlertPayload) => Promise<DeliveryResult>;
  calls: ProductionEnvGuardAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubChannel {
  const calls: ProductionEnvGuardAlertPayload[] = [];
  const fn = vi.fn(
    async (p: ProductionEnvGuardAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, secretId: p.secret.id, ok: true };
    },
  );
  return { fn, calls };
}

const ALL_GUARDED_ENV_VARS = GUARDED_SECRETS.map((s) => s.envVar);

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of [...ALL_GUARDED_ENV_VARS, "NODE_ENV"]) {
    snap[k] = process.env[k];
  }
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

/**
 * Set every guarded secret to a non-defaulted value so tests can opt
 * individual secrets back into "missing" without picking up unrelated
 * misconfigurations from the host process env.
 */
function configureAllSecrets(): void {
  for (const s of GUARDED_SECRETS) {
    process.env[s.envVar] = `real-${s.envVar.toLowerCase()}-value`;
  }
}

describe("production-env-guard", () => {
  let pd: StubChannel;
  let email: StubChannel;
  let slack: StubChannel;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    __resetProductionEnvGuardForTests();
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setProductionEnvGuardDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.NODE_ENV = "production";
    configureAllSecrets();
  });

  afterEach(() => {
    __setProductionEnvGuardDeliveriesForTests(null);
    warnSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    restoreEnv(envSnapshot);
    vi.useRealTimers();
  });

  it("treats unset, empty, whitespace, and defaulted values as misconfigured", () => {
    const jwt = GUARDED_SECRETS.find((s) => s.envVar === "JWT_SECRET")!;
    const session = GUARDED_SECRETS.find((s) => s.envVar === "SESSION_SECRET")!;

    delete process.env.JWT_SECRET;
    expect(isSecretMisconfigured(jwt)).toBe(true);

    process.env.JWT_SECRET = "";
    expect(isSecretMisconfigured(jwt)).toBe(true);

    process.env.JWT_SECRET = "   ";
    expect(isSecretMisconfigured(jwt)).toBe(true);

    process.env.JWT_SECRET = "dev-secret-change-me";
    expect(isSecretMisconfigured(jwt)).toBe(true);

    process.env.JWT_SECRET = "  dev-secret-change-me  ";
    expect(isSecretMisconfigured(jwt)).toBe(true);

    process.env.JWT_SECRET = "actually-a-real-secret";
    expect(isSecretMisconfigured(jwt)).toBe(false);

    // SESSION_SECRET has no defaulted-values list; only unset/blank counts.
    delete process.env.SESSION_SECRET;
    expect(isSecretMisconfigured(session)).toBe(true);
    process.env.SESSION_SECRET = "real-session";
    expect(isSecretMisconfigured(session)).toBe(false);
  });

  it("is a no-op outside production even if every secret is missing", async () => {
    process.env.NODE_ENV = "development";
    for (const s of GUARDED_SECRETS) delete process.env[s.envVar];

    const results = await evaluateProductionEnvGuards();
    const missing = getMisconfiguredCriticalSecrets();

    expect(results).toEqual([]);
    expect(missing).toEqual([]);
    expect(pd.calls).toHaveLength(0);
    expect(email.calls).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  it("fires per missing secret on every channel with per-secret dedup ids", async () => {
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;

    await evaluateProductionEnvGuards();

    const pdSecretIds = pd.calls.map((c) => c.secret.id).sort();
    expect(pdSecretIds).toEqual(
      ["jwt-secret-missing", "session-secret-missing"].sort(),
    );
    expect(pd.calls.every((c) => c.kind === "fire")).toBe(true);
    expect(email.calls).toHaveLength(2);
    expect(slack.calls).toHaveLength(2);
  });

  it("fires only for the newly-missing secret on incremental detection", async () => {
    delete process.env.JWT_SECRET;
    await evaluateProductionEnvGuards();
    expect(pd.calls).toHaveLength(1);
    expect(pd.calls[0].secret.envVar).toBe("JWT_SECRET");

    // Now SESSION_SECRET goes missing too — JWT_SECRET should not re-fire.
    delete process.env.SESSION_SECRET;
    await evaluateProductionEnvGuards();

    expect(pd.calls).toHaveLength(2);
    expect(pd.calls[1].secret.envVar).toBe("SESSION_SECRET");
    const jwtFires = pd.calls.filter(
      (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "fire",
    );
    expect(jwtFires).toHaveLength(1);
  });

  it("does not re-fire while a secret stays missing across polls", async () => {
    delete process.env.JWT_SECRET;
    await evaluateProductionEnvGuards();
    await evaluateProductionEnvGuards();
    await evaluateProductionEnvGuards();

    expect(pd.calls).toHaveLength(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("clears one secret independently of another that stays missing", async () => {
    delete process.env.JWT_SECRET;
    delete process.env.SESSION_SECRET;
    await evaluateProductionEnvGuards();
    expect(pd.calls).toHaveLength(2);

    process.env.JWT_SECRET = "restored-secret";
    await evaluateProductionEnvGuards();

    const jwtClears = pd.calls.filter(
      (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "clear",
    );
    const sessionClears = pd.calls.filter(
      (c) => c.secret.envVar === "SESSION_SECRET" && c.kind === "clear",
    );
    expect(jwtClears).toHaveLength(1);
    expect(sessionClears).toHaveLength(0);
  });

  it("re-fires after recovery once a new outage transitions in", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    delete process.env.JWT_SECRET;
    await evaluateProductionEnvGuards();

    process.env.JWT_SECRET = "restored";
    await evaluateProductionEnvGuards();

    // Wait past the per-channel throttle window before the next outage.
    vi.setSystemTime(new Date("2026-01-01T02:00:00Z"));
    delete process.env.JWT_SECRET;
    await evaluateProductionEnvGuards();

    const jwtFires = pd.calls.filter(
      (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "fire",
    );
    const jwtClears = pd.calls.filter(
      (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "clear",
    );
    expect(jwtFires).toHaveLength(2);
    expect(jwtClears).toHaveLength(1);
  });

  it("throttles a re-fire that happens within the per-channel throttle window", async () => {
    const prev = process.env.PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS;
    process.env.PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS = String(
      24 * 60 * 60 * 1000,
    );
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

      delete process.env.JWT_SECRET;
      await evaluateProductionEnvGuards();
      expect(
        pd.calls.filter(
          (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "fire",
        ),
      ).toHaveLength(1);

      // Recover, then immediately go bad again — well inside the 24h throttle.
      process.env.JWT_SECRET = "restored";
      await evaluateProductionEnvGuards();
      vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
      delete process.env.JWT_SECRET;
      const results = await evaluateProductionEnvGuards();

      // No NEW "fire" delivery on any channel for JWT_SECRET.
      expect(
        pd.calls.filter(
          (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "fire",
        ),
      ).toHaveLength(1);
      expect(
        email.calls.filter(
          (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "fire",
        ),
      ).toHaveLength(1);
      expect(
        slack.calls.filter(
          (c) => c.secret.envVar === "JWT_SECRET" && c.kind === "fire",
        ),
      ).toHaveLength(1);

      const throttled = results.filter(
        (r) =>
          r.skipped &&
          r.reason === "throttled" &&
          r.secretId === "jwt-secret-missing",
      );
      expect(throttled).toHaveLength(3);
    } finally {
      if (prev === undefined) {
        delete process.env.PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS;
      } else {
        process.env.PRODUCTION_ENV_GUARD_NOTIFICATION_THROTTLE_MS = prev;
      }
    }
  });

  it("does not let a single delivery failure block other deliveries", async () => {
    __setProductionEnvGuardDeliveriesForTests({
      pagerduty: async () => {
        throw new Error("pd boom");
      },
      email: email.fn,
      slack: slack.fn,
    });

    delete process.env.JWT_SECRET;
    const results = await evaluateProductionEnvGuards();

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
    const pdResult = results.find(
      (r) => r.channel === "pagerduty" && r.secretId === "jwt-secret-missing",
    );
    expect(pdResult?.ok).toBe(false);
    expect(pdResult?.reason).toContain("pd boom");
  });

  it("does not double-fire when two evaluations race on the same first-time outage", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let pdInflight = 0;
    let pdMaxInflight = 0;
    __setProductionEnvGuardDeliveriesForTests({
      pagerduty: async (p) => {
        pdInflight += 1;
        pdMaxInflight = Math.max(pdMaxInflight, pdInflight);
        await gate;
        pdInflight -= 1;
        return { channel: "pagerduty", secretId: p.secret.id, ok: true };
      },
      email: email.fn,
      slack: slack.fn,
    });

    delete process.env.JWT_SECRET;
    const a = evaluateProductionEnvGuards();
    const b = evaluateProductionEnvGuards();
    release();
    const [resA, resB] = await Promise.all([a, b]);

    const dispatched = [resA, resB].filter((r) => r.length > 0);
    expect(dispatched).toHaveLength(1);
    expect(pdMaxInflight).toBe(1);
    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });

  it("treats unconfigured providers as skipped without consuming the throttle slot", async () => {
    __setProductionEnvGuardDeliveriesForTests({
      pagerduty: async (p) => ({
        channel: "pagerduty",
        secretId: p.secret.id,
        ok: true,
        skipped: true,
        reason: "not_configured",
      }),
      email: email.fn,
      slack: slack.fn,
    });

    delete process.env.JWT_SECRET;
    const r1 = await evaluateProductionEnvGuards();
    const pd1 = r1.find(
      (r) => r.channel === "pagerduty" && r.secretId === "jwt-secret-missing",
    );
    expect(pd1?.skipped).toBe(true);
    expect(pd1?.reason).toBe("not_configured");

    expect(email.calls).toHaveLength(1);
    expect(slack.calls).toHaveLength(1);
  });
});
