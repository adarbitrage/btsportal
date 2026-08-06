import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const mutateSpy = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useCreateTicket: () => ({ mutate: mutateSpy, isPending: false }),
}));

import ContactUs from "../ContactUs";

describe("Contact Us page", () => {
  beforeEach(() => {
    mutateSpy.mockClear();
    toastSpy.mockClear();
  });

  it("renders the supplied contact form, consent links, and FAQ entry point", () => {
    render(<ContactUs />);

    expect(screen.getByText("Send us a Message")).toBeInTheDocument();
    expect(screen.getByTestId("input-contact-name")).toBeInTheDocument();
    expect(screen.getByTestId("input-contact-email")).toBeInTheDocument();
    expect(screen.getByTestId("input-contact-message")).toBeInTheDocument();
    expect(screen.getByTestId("button-send-message")).toBeInTheDocument();

    // Consent text links to Terms of Service and Privacy Policy.
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/legal/terms",
    );
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );

    // FAQ callout.
    expect(screen.getByText("Need Immediate Answers?")).toBeInTheDocument();
    expect(screen.getByTestId("link-visit-faq").closest("a")).toHaveAttribute(
      "href",
      "https://buildtestscale.com/faq",
    );

    // Contact information from the supplied copy.
    expect(screen.getAllByText(/5900 Balcones Drive/).length).toBeGreaterThan(0);
    expect(screen.getByText("support@buildtestscale.com")).toBeInTheDocument();
    expect(screen.getAllByText(/1-888-996-5513/).length).toBeGreaterThan(0);

    // Contact page terms and conditions section.
    expect(screen.getByText("CONTACT PAGE TERMS AND CONDITIONS")).toBeInTheDocument();
    expect(screen.getByText("I. BUSINESS CONTACT INFORMATION")).toBeInTheDocument();
    expect(screen.getByText("III. RESPONSE TIME")).toBeInTheDocument();
  });

  it("submits the form through the member ticket API", () => {
    render(<ContactUs />);

    fireEvent.change(screen.getByTestId("input-contact-name"), {
      target: { value: "Jane Member" },
    });
    fireEvent.change(screen.getByTestId("input-contact-email"), {
      target: { value: "jane@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-contact-message"), {
      target: { value: "I need help with my account." },
    });
    fireEvent.click(screen.getByTestId("button-send-message"));

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const { data } = mutateSpy.mock.calls[0][0];
    expect(data.category).toBe("other");
    expect(data.subject).toContain("Jane Member");
    expect(data.description).toContain("I need help with my account.");
    expect(data.description).toContain("jane@example.com");
    expect(data.source).toBe("contact_us_page");
  });

  it("does not submit an empty message", () => {
    render(<ContactUs />);
    fireEvent.click(screen.getByTestId("button-send-message"));
    expect(mutateSpy).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalled();
  });
});
