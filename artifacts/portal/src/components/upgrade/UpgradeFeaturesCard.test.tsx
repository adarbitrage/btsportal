import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpgradeFeaturesCard } from "./UpgradeFeaturesCard";

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

let capturedRequests: CapturedRequest[];

function installFetchMock() {
  capturedRequests = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    let body: Record<string, unknown> = {};
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = {};
      }
    }
    capturedRequests.push({ url, body });
    return {
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: new Headers(),
      json: async () => ({}),
      text: async () => "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

const ENTITLEMENTS = new Set<string>(["content:frontend", "support:basic"]);

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UpgradeFeaturesCard analytics", () => {
  it("does not render or fire an impression while sourceTier is null (still loading)", async () => {
    render(
      <UpgradeFeaturesCard
        entitlements={ENTITLEMENTS}
        hasLifetime={false}
        variant="dashboard"
        sourceTier={null}
      />,
    );

    expect(screen.queryByTestId("upgrade-features-card-dashboard")).toBeNull();

    // Give any pending microtasks a chance to flush.
    await act(async () => {
      await Promise.resolve();
    });

    const analyticsCalls = capturedRequests.filter((r) => r.url.includes("/analytics/events"));
    expect(analyticsCalls).toHaveLength(0);
  });

  it("fires exactly one impression once sourceTier becomes available, with the resolved tier", async () => {
    const { rerender } = render(
      <UpgradeFeaturesCard
        entitlements={new Set<string>()}
        hasLifetime={false}
        variant="dashboard"
        sourceTier={null}
      />,
    );

    expect(screen.queryByTestId("upgrade-features-card-dashboard")).toBeNull();
    expect(capturedRequests).toHaveLength(0);

    rerender(
      <UpgradeFeaturesCard
        entitlements={ENTITLEMENTS}
        hasLifetime={false}
        variant="dashboard"
        sourceTier="reserve_income"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-features-card-dashboard")).toBeInTheDocument();
    });

    await waitFor(() => {
      const analyticsCalls = capturedRequests.filter((r) =>
        r.url.includes("/analytics/events"),
      );
      expect(analyticsCalls).toHaveLength(1);
    });

    const [impression] = capturedRequests.filter((r) => r.url.includes("/analytics/events"));
    expect(impression.body).toMatchObject({
      eventType: "impression",
      variant: "dashboard",
      sourceTier: "reserve_income",
    });
    expect(Array.isArray(impression.body.lockedFeatureKeys)).toBe(true);
    expect((impression.body.lockedFeatureKeys as string[]).length).toBeGreaterThan(0);
  });

  it("fires a cta_click event when the dashboard CTA is pressed", async () => {
    const onCtaClick = vi.fn();
    render(
      <UpgradeFeaturesCard
        entitlements={ENTITLEMENTS}
        hasLifetime={false}
        variant="dashboard"
        sourceTier="reserve_income"
        onCtaClick={onCtaClick}
      />,
    );

    await waitFor(() => {
      const analyticsCalls = capturedRequests.filter((r) =>
        r.url.includes("/analytics/events"),
      );
      expect(analyticsCalls).toHaveLength(1);
    });

    const cta = screen.getByTestId("upgrade-features-cta-dashboard");
    await userEvent.click(cta);

    await waitFor(() => {
      const analyticsCalls = capturedRequests.filter((r) =>
        r.url.includes("/analytics/events"),
      );
      expect(analyticsCalls).toHaveLength(2);
    });

    const clickEvent = capturedRequests
      .filter((r) => r.url.includes("/analytics/events"))
      .find((r) => r.body.eventType === "cta_click");
    expect(clickEvent).toBeDefined();
    expect(clickEvent!.body).toMatchObject({
      eventType: "cta_click",
      variant: "dashboard",
      sourceTier: "reserve_income",
    });
    expect(onCtaClick).toHaveBeenCalledTimes(1);
  });

  it("only reports the locked feature keys actually shown in the sidebar (capped at 4)", async () => {
    render(
      <UpgradeFeaturesCard
        entitlements={new Set<string>()}
        hasLifetime={false}
        variant="sidebar"
        sourceTier="reserve_income"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("upgrade-features-card-sidebar")).toBeInTheDocument();
    });

    await waitFor(() => {
      const analyticsCalls = capturedRequests.filter((r) =>
        r.url.includes("/analytics/events"),
      );
      expect(analyticsCalls).toHaveLength(1);
    });

    const [impression] = capturedRequests.filter((r) => r.url.includes("/analytics/events"));
    expect(impression.body).toMatchObject({
      eventType: "impression",
      variant: "sidebar",
      sourceTier: "reserve_income",
    });
    const keys = impression.body.lockedFeatureKeys as string[];
    expect(keys.length).toBeLessThanOrEqual(4);
  });

  it("does not render or track when the member has lifetime access", async () => {
    render(
      <UpgradeFeaturesCard
        entitlements={new Set<string>(["access:lifetime"])}
        hasLifetime={true}
        variant="dashboard"
        sourceTier="lifetime"
      />,
    );

    expect(screen.queryByTestId("upgrade-features-card-dashboard")).toBeNull();

    await act(async () => {
      await Promise.resolve();
    });

    expect(capturedRequests.filter((r) => r.url.includes("/analytics/events"))).toHaveLength(0);
  });
});
