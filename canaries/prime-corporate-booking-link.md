# Canary: Prime Corporate booking link URL

**Task:** Update Prime Corporate booking link to new URL

## What to verify
After publishing, the served production portal bundle must contain the new booking URL and must NOT contain the old one.

## Fast canary steps

```bash
# 1. Fetch the live portal index to find the hashed JS bundle filename
BUNDLE_URL=$(curl -s https://<PORTAL_DOMAIN>/ | grep -oP '(?<=src=")[^"]*index[^"]*\.js(?=")')

# 2. Check the new URL is present in the bundle
curl -s "https://<PORTAL_DOMAIN>${BUNDLE_URL}" | grep -q "primecorporateservices.com/bts/" \
  && echo "PASS: new URL found" || echo "FAIL: new URL missing"

# 3. Check the old URL is absent from the bundle
curl -s "https://<PORTAL_DOMAIN>${BUNDLE_URL}" | grep -q "primepartner.info/BuildTestScale" \
  && echo "FAIL: old URL still present" || echo "PASS: old URL absent"
```

## Expected outcome
- `primecorporateservices.com/bts/` — **present** in bundle
- `primepartner.info/BuildTestScale` — **absent** from bundle

## Affected file
`artifacts/portal/src/pages/PrimeCorporate.tsx` — `href` on the "Book Your Free Empire-Building Session" `<a>` element.
