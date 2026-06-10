// Turns a raw browser user-agent string into a human-friendly device label
// like "Chrome on Mac" or "Safari on iPhone" so members can recognise their
// own sessions in the "Where you're signed in" list. Parsing is intentionally
// best-effort: if we can't confidently identify a browser or OS we fall back
// to the raw user-agent string, and to "Unknown device" when there's nothing
// to show at all. We never throw — a malformed UA must not break the page.

function detectBrowser(ua: string): string | null {
  // Order matters: Chromium-based browsers all advertise "Chrome", and
  // Safari appears in nearly every WebKit UA, so the more specific tokens
  // (Edge, Opera, Samsung, in-app Chrome/Firefox on iOS) must win first.
  if (/\bEdg(?:A|iOS)?\//.test(ua)) return "Edge";
  if (/\b(?:OPR|Opera)\//.test(ua)) return "Opera";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/\bCriOS\//.test(ua)) return "Chrome";
  if (/\bFxiOS\//.test(ua)) return "Firefox";
  if (/\bFirefox\//.test(ua)) return "Firefox";
  if (/\bChrome\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari";
  if (/\bMSIE\b|\bTrident\//.test(ua)) return "Internet Explorer";
  return null;
}

function detectOS(ua: string): string | null {
  if (/\biPhone\b/.test(ua)) return "iPhone";
  if (/\biPad\b/.test(ua)) return "iPad";
  if (/\biPod\b/.test(ua)) return "iPod";
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/\bWindows NT\b/.test(ua)) return "Windows";
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "Mac";
  if (/\bLinux\b/.test(ua)) return "Linux";
  return null;
}

export function formatDeviceLabel(
  userAgent: string | null | undefined,
): string {
  if (!userAgent || !userAgent.trim()) return "Unknown device";
  const ua = userAgent.trim();

  const browser = detectBrowser(ua);
  const os = detectOS(ua);

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;

  // Couldn't recognise anything — show the raw value rather than hide it.
  return ua;
}
