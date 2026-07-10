import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import VipArbitrage from "./VipArbitrage";

describe("VipArbitrage landing page", () => {
  it("renders the offering title and Reg D 506(c) compliance messaging", () => {
    render(<VipArbitrage />);

    expect(screen.getByTestId("text-vip-arbitrage-title")).toHaveTextContent("VIP Arbitrage");

    const body = document.body.textContent ?? "";
    expect(body).toContain("Rule 506(c) of Regulation D");
    expect(body).toContain("accredited investor");
    expect(body).toContain("Important Disclosures");
    expect(body).toContain("not an offer to sell");
    expect(body).toContain("no returns are promised");
  });
});
