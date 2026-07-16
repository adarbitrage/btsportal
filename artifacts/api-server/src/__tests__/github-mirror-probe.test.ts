import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";

import {
  evaluateGithubMirrorProbe,
  getGithubMirrorProbeState,
  __resetGithubMirrorProbeForTests,
  __setGithubMirrorProbeDeliveriesForTests,
  __setGithubMirrorProbeFetchForTests,
  __setGithubMirrorLocalShaForTests,
  __setGithubMirrorFailcountForTests,
  type DeliveryResult,
  type GithubMirrorAlertPayload,
} from "../lib/github-mirror-probe";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/**
 * Fetch stub keyed on URL: /repos/<repo> gets `repoResponse`, the
 * git/ref/heads/main call gets `refResponse` (defaults to SHA_A).
 */
function fetchStub(opts: {
  repoStatus?: number;
  repoBody?: unknown;
  refStatus?: number;
  refSha?: string;
  throwNetwork?: string;
}): typeof fetch {
  return (async (url: string | URL | Request) => {
    if (opts.throwNetwork) throw new Error(opts.throwNetwork);
    const u = String(url);
    if (u.includes("/git/ref/heads/main")) {
      return new Response(
        JSON.stringify({ object: { sha: opts.refSha ?? SHA_A } }),
        { status: opts.refStatus ?? 200 },
      );
    }
    return new Response(
      JSON.stringify(
        opts.repoBody ?? { permissions: { push: true } },
      ),
      { status: opts.repoStatus ?? 200 },
    );
  }) as unknown as typeof fetch;
}

interface StubDelivery {
  fn: (p: GithubMirrorAlertPayload) => Promise<DeliveryResult>;
  calls: GithubMirrorAlertPayload[];
}

function makeStub(channel: "pagerduty" | "email" | "slack"): StubDelivery {
  const calls: GithubMirrorAlertPayload[] = [];
  const fn = vi.fn(
    async (p: GithubMirrorAlertPayload): Promise<DeliveryResult> => {
      calls.push(p);
      return { channel, ok: true };
    },
  );
  return { fn, calls };
}

describe("GitHub mirror probe state machine", () => {
  let pd: StubDelivery;
  let email: StubDelivery;
  let slack: StubDelivery;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    __resetGithubMirrorProbeForTests();
    process.env.GITHUB_TOKEN = "test-token";
    pd = makeStub("pagerduty");
    email = makeStub("email");
    slack = makeStub("slack");
    __setGithubMirrorProbeDeliveriesForTests({
      pagerduty: pd.fn,
      email: email.fn,
      slack: slack.fn,
    });
    __setGithubMirrorLocalShaForTests(async () => SHA_A);
    __setGithubMirrorFailcountForTests(async () => null);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    logSpy?.mockRestore();
    errSpy?.mockRestore();
  });

  afterAll(() => {
    __resetGithubMirrorProbeForTests();
  });

  it("reports ok + inSync when the token works and SHAs match", async () => {
    __setGithubMirrorProbeFetchForTests(fetchStub({}));
    const { outcome, deliveries } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("ok");
    expect(deliveries).toEqual([]);
    const state = getGithubMirrorProbeState();
    expect(state.status).toBe("ok");
    expect(state.alerting).toBe(false);
    expect(state.consecutiveAuthFailed).toBe(0);
    expect(state.remoteSha).toBe(SHA_A);
    expect(state.localSha).toBe(SHA_A);
    expect(state.inSync).toBe(true);
  });

  it("reports ok with inSync=false when GitHub main differs from local (advisory only — no alert)", async () => {
    __setGithubMirrorProbeFetchForTests(fetchStub({ refSha: SHA_B }));
    const { outcome, deliveries } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("ok");
    expect(outcome.inSync).toBe(false);
    expect(deliveries).toEqual([]);
    expect(pd.calls.length).toBe(0);
    expect(getGithubMirrorProbeState().inSync).toBe(false);
  });

  it("reports ok with inSync=null when no local git repo is available", async () => {
    __setGithubMirrorLocalShaForTests(async () => null);
    __setGithubMirrorProbeFetchForTests(fetchStub({}));
    const { outcome } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("ok");
    expect(outcome.inSync).toBe(null);
    expect(outcome.remoteSha).toBe(SHA_A);
  });

  it("reports unconfigured (never alerting) when GITHUB_TOKEN is unset", async () => {
    delete process.env.GITHUB_TOKEN;
    __setGithubMirrorProbeFetchForTests(fetchStub({}));
    const { outcome, deliveries } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("unconfigured");
    expect(deliveries).toEqual([]);
    const state = getGithubMirrorProbeState();
    expect(state.status).toBe("unconfigured");
    expect(state.alerting).toBe(false);
  });

  it("classifies 401 as auth_failed and fires only after 3 consecutive failures", async () => {
    __setGithubMirrorProbeFetchForTests(fetchStub({ repoStatus: 401 }));

    await evaluateGithubMirrorProbe();
    expect(pd.calls.length).toBe(0);
    expect(getGithubMirrorProbeState().alerting).toBe(false);

    await evaluateGithubMirrorProbe();
    expect(pd.calls.length).toBe(0);
    expect(getGithubMirrorProbeState().consecutiveAuthFailed).toBe(2);

    const { deliveries } = await evaluateGithubMirrorProbe();
    expect(pd.calls.length).toBe(1);
    expect(pd.calls[0].kind).toBe("fire");
    expect(email.calls.length).toBe(1);
    expect(slack.calls.length).toBe(1);
    expect(deliveries.some((d) => d.channel === "pagerduty" && d.ok)).toBe(true);

    const state = getGithubMirrorProbeState();
    expect(state.status).toBe("auth_failed");
    expect(state.alerting).toBe(true);
    expect(state.consecutiveAuthFailed).toBe(3);
    expect(state.reasons.join(" ")).toMatch(/expired or revoked/i);
  });

  it("classifies 404 (repo no longer visible to token) as auth_failed", async () => {
    __setGithubMirrorProbeFetchForTests(fetchStub({ repoStatus: 404 }));
    const { outcome } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("auth_failed");
    expect(outcome.reasons.join(" ")).toMatch(/can no longer access/i);
  });

  it("classifies a read-only token (permissions.push=false) as auth_failed", async () => {
    __setGithubMirrorProbeFetchForTests(
      fetchStub({ repoBody: { permissions: { push: false } } }),
    );
    const { outcome } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("auth_failed");
    expect(outcome.reasons.join(" ")).toMatch(/read-only/i);
  });

  it("treats a network error as unreachable — no streak bump, no alert clear", async () => {
    // Get into an alerting state first.
    __setGithubMirrorProbeFetchForTests(fetchStub({ repoStatus: 401 }));
    await evaluateGithubMirrorProbe();
    await evaluateGithubMirrorProbe();
    await evaluateGithubMirrorProbe();
    expect(getGithubMirrorProbeState().alerting).toBe(true);

    __setGithubMirrorProbeFetchForTests(fetchStub({ throwNetwork: "ECONNRESET" }));
    const { outcome, deliveries } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("unreachable");
    expect(deliveries).toEqual([]);
    const state = getGithubMirrorProbeState();
    expect(state.alerting).toBe(true); // NOT cleared by an inconclusive probe
    expect(state.consecutiveAuthFailed).toBe(3); // unchanged
    expect(state.consecutiveUnreachable).toBe(1);
    expect(state.lastError).toMatch(/ECONNRESET/);
  });

  it("treats a 5xx as unreachable (inconclusive)", async () => {
    __setGithubMirrorProbeFetchForTests(fetchStub({ repoStatus: 503 }));
    const { outcome } = await evaluateGithubMirrorProbe();
    expect(outcome.status).toBe("unreachable");
    expect(getGithubMirrorProbeState().consecutiveAuthFailed).toBe(0);
  });

  it("clears the alert (kind=clear) on the first ok probe after alerting", async () => {
    __setGithubMirrorProbeFetchForTests(fetchStub({ repoStatus: 401 }));
    await evaluateGithubMirrorProbe();
    await evaluateGithubMirrorProbe();
    await evaluateGithubMirrorProbe();
    expect(getGithubMirrorProbeState().alerting).toBe(true);
    expect(pd.calls.length).toBe(1);

    __setGithubMirrorProbeFetchForTests(fetchStub({}));
    const { deliveries } = await evaluateGithubMirrorProbe();
    expect(pd.calls.length).toBe(2);
    expect(pd.calls[1].kind).toBe("clear");
    expect(deliveries.length).toBeGreaterThan(0);
    const state = getGithubMirrorProbeState();
    expect(state.alerting).toBe(false);
    expect(state.consecutiveAuthFailed).toBe(0);
    expect(state.status).toBe("ok");
  });

  it("surfaces the merge-time failcount from github-sync.sh in the state view", async () => {
    __setGithubMirrorFailcountForTests(async () => 4);
    __setGithubMirrorProbeFetchForTests(fetchStub({}));
    await evaluateGithubMirrorProbe();
    expect(getGithubMirrorProbeState().mergeFailcount).toBe(4);
  });
});
