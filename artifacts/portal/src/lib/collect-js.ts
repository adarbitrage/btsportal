declare global {
  interface Window {
    CollectJS?: {
      configure: (options: CollectJsOptions) => void;
      startPaymentRequest: () => void;
    };
  }
}

interface CollectJsField {
  selector: string;
  placeholder?: string;
}

interface CollectJsCardInfo {
  number?: string;
  exp?: string;
  type?: string;
}

interface CollectJsTokenResponse {
  token: string;
  card?: CollectJsCardInfo;
}

interface CollectJsOptions {
  variant: "inline";
  styleSniffer?: boolean;
  fields?: {
    ccnumber?: CollectJsField;
    ccexp?: CollectJsField;
    cvv?: CollectJsField;
  };
  callback?: (response: CollectJsTokenResponse) => void;
}

const COLLECT_JS_URL = "https://secure.nmi.com/token/Collect.js";

let scriptLoadPromise: Promise<void> | null = null;

function loadScript(tokenizationKey: string): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("collect-js-script");
    if (existing) existing.remove();

    const script = document.createElement("script");
    script.id = "collect-js-script";
    script.src = COLLECT_JS_URL;
    script.setAttribute("data-tokenization-key", tokenizationKey);
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error("Failed to load Collect.js. Check your network connection."));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

export interface CollectJsFieldSelectors {
  ccnumber: string;
  ccexp: string;
  cvv: string;
}

export interface CollectJsTokenResult {
  token: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

export interface CollectJsHandle {
  tokenize: () => Promise<CollectJsTokenResult>;
}

/**
 * Extract masked card metadata from the Collect.js tokenization callback.
 *
 * Collect.js returns `card.number` already masked by the gateway (e.g. "XXXXXXXXXXXX1234"
 * or "************1234") — only the last four digits are ever transmitted.  No raw PAN
 * is exposed in this callback, so reading from `card.number` here preserves PCI scope.
 * See: https://developer.nmi.com/docs/collect-js/getting-started/
 */
function parseCardInfo(card: CollectJsCardInfo | undefined): Pick<CollectJsTokenResult, "last4" | "brand" | "expMonth" | "expYear"> {
  const rawNumber = card?.number ?? "";
  const last4 = rawNumber.replace(/\D/g, "").slice(-4) || "0000";

  const rawType = (card?.type ?? "").toLowerCase().trim();
  const brand =
    rawType === "american express" || rawType === "amex"
      ? "amex"
      : rawType === "mastercard"
        ? "mastercard"
        : rawType === "visa"
          ? "visa"
          : rawType === "discover"
            ? "discover"
            : rawType === "jcb"
              ? "jcb"
              : rawType === "diners club" || rawType === "diners"
                ? "diners"
                : rawType === "unionpay"
                  ? "unionpay"
                  : rawType === "maestro"
                    ? "maestro"
                    : rawType || "unknown";

  const rawExp = card?.exp ?? "";
  const digits = rawExp.replace(/\D/g, "");
  const expMonth = digits.length >= 2 ? parseInt(digits.slice(0, 2), 10) : 1;
  const rawYear = digits.length >= 4 ? parseInt(digits.slice(2, 4), 10) : 0;
  const expYear = rawYear < 100 ? 2000 + rawYear : rawYear;

  return { last4, brand, expMonth, expYear };
}

export async function initCollectJs(
  tokenizationKey: string,
  selectors: CollectJsFieldSelectors,
): Promise<CollectJsHandle> {
  await loadScript(tokenizationKey);

  const collectJs = window.CollectJS;
  if (!collectJs) {
    throw new Error("Collect.js did not initialize correctly. Please refresh and try again.");
  }

  // Closure over the pending promise callbacks. The configure() call below
  // injects the hosted iframe fields into the page immediately so users can
  // start typing their card details. The single callback routes to whichever
  // tokenize() attempt is currently in flight — this avoids re-calling
  // configure() on every submit (which would recreate the iframes and clear
  // any partially-entered card data).
  let pendingResolve: ((result: CollectJsTokenResult) => void) | null = null;
  let pendingReject: ((err: Error) => void) | null = null;

  collectJs.configure({
    variant: "inline",
    fields: {
      ccnumber: { selector: selectors.ccnumber, placeholder: "Card number" },
      ccexp: { selector: selectors.ccexp, placeholder: "MM / YY" },
      cvv: { selector: selectors.cvv, placeholder: "CVV" },
    },
    callback: (response) => {
      const resolve = pendingResolve;
      const reject = pendingReject;
      pendingResolve = null;
      pendingReject = null;

      if (response?.token) {
        const cardMeta = parseCardInfo(response.card);
        resolve?.({ token: response.token, ...cardMeta });
      } else {
        reject?.(
          new Error("Tokenization failed. Please check your card details and try again."),
        );
      }
    },
  });

  const tokenize = (): Promise<CollectJsTokenResult> => {
    return new Promise<CollectJsTokenResult>((resolve, reject) => {
      if (pendingResolve !== null || pendingReject !== null) {
        reject(new Error("A tokenization is already in progress."));
        return;
      }

      const timeoutId = setTimeout(() => {
        pendingResolve = null;
        pendingReject = null;
        reject(new Error("Card tokenization timed out. Please try again."));
      }, 30_000);

      pendingResolve = (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      };
      pendingReject = (err) => {
        clearTimeout(timeoutId);
        reject(err);
      };

      collectJs.startPaymentRequest();
    });
  };

  return { tokenize };
}

export function formatCentsAsDollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
