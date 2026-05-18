import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-layout-stub">{children}</div>
  ),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const authFetchMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { name: "Casey Member", email: "casey@example.test" },
  }),
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

let currentSearch = "";
vi.mock("wouter", () => ({
  useSearch: () => currentSearch,
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import GeneralSupport from "@/pages/GeneralSupport";

beforeEach(() => {
  currentSearch = "";
  toastMock.mockReset();
  authFetchMock.mockReset();
  authFetchMock.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GeneralSupport — topic pre-fill from query string", () => {
  it("pre-fills the message when topic=email-admin-cancelled is set", () => {
    currentSearch = "topic=email-admin-cancelled";
    render(<GeneralSupport />);

    // The textarea is the only multi-line input on the page; assert its
    // initial value mentions the cancelled email change so the member sees
    // context they didn't have to type.
    const textareas = screen.getAllByRole("textbox") as HTMLElement[];
    const textarea = textareas.find(
      (el) => el.tagName.toLowerCase() === "textarea",
    ) as HTMLTextAreaElement | undefined;
    expect(textarea).toBeDefined();
    expect(textarea!.value.toLowerCase()).toMatch(
      /email change.*cancelled by an administrator/i,
    );
  });

  it("submits with the topic-specific subject when topic=email-admin-cancelled", async () => {
    currentSearch = "topic=email-admin-cancelled";
    render(<GeneralSupport />);

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledTimes(1);
    });

    const [path, init] = authFetchMock.mock.calls[0] as [
      string,
      { method?: string; body?: string },
    ];
    expect(path).toBe("/tickets");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body ?? "{}");
    // The subject is what shows up in the support inbox; using the topic
    // preset means the support team sees the cancellation context up-front
    // rather than the generic "General Support Request" line.
    expect(body.subject).toBe("Question about cancelled email change");
    expect(body.category).toBe("other");
  });

  it("falls back to the default subject and an empty message when no topic is set", async () => {
    currentSearch = "";
    render(<GeneralSupport />);

    const textareas = screen.getAllByRole("textbox") as HTMLElement[];
    const textarea = textareas.find(
      (el) => el.tagName.toLowerCase() === "textarea",
    ) as HTMLTextAreaElement | undefined;
    expect(textarea).toBeDefined();
    // Without a topic, we don't want to put words in the member's mouth —
    // the box should start empty so they write what they actually need.
    expect(textarea!.value).toBe("");

    fireEvent.change(textarea!, { target: { value: "Hello, I need help." } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await waitFor(() => {
      expect(authFetchMock).toHaveBeenCalledTimes(1);
    });
    const [, init] = authFetchMock.mock.calls[0] as [
      string,
      { body?: string },
    ];
    const body = JSON.parse(init.body ?? "{}");
    expect(body.subject).toBe("General Support Request from Casey Member");
  });

  it("ignores unknown topic values and behaves like no topic", () => {
    currentSearch = "topic=does-not-exist";
    render(<GeneralSupport />);

    const textareas = screen.getAllByRole("textbox") as HTMLElement[];
    const textarea = textareas.find(
      (el) => el.tagName.toLowerCase() === "textarea",
    ) as HTMLTextAreaElement | undefined;
    expect(textarea).toBeDefined();
    expect(textarea!.value).toBe("");
  });

  it("shows a topic-aware notice above the form when topic=email-admin-cancelled", () => {
    currentSearch = "topic=email-admin-cancelled";
    render(<GeneralSupport />);

    // The notice reassures the member that their cancellation context
    // carried over so they don't wipe the pre-filled message thinking
    // it's stale.
    const notice = screen.getByTestId("topic-notice");
    expect(notice.textContent?.toLowerCase()).toMatch(
      /cancelled email change/i,
    );
  });

  it("does not render the topic notice when no topic is set", () => {
    currentSearch = "";
    render(<GeneralSupport />);
    expect(screen.queryByTestId("topic-notice")).toBeNull();
  });

  it("does not render the topic notice for unknown topic values", () => {
    currentSearch = "topic=does-not-exist";
    render(<GeneralSupport />);
    expect(screen.queryByTestId("topic-notice")).toBeNull();
  });
});
