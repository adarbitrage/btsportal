import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

import PartnerTools from "./PartnerTools";

describe("PartnerTools page copy", () => {
  it('renders "included with your membership" and not the old "free with your membership"', () => {
    render(<PartnerTools />);

    expect(screen.getByText("included with your membership")).toBeInTheDocument();

    expect(document.body.textContent ?? "").not.toContain("free with your membership");
  });
});
