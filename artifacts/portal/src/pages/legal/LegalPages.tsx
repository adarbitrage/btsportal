import { LegalDocument } from "@/components/legal/LegalDocument";
import {
  privacyPolicyTitle,
  privacyPolicyBody,
} from "@/content/legal/privacy-policy";
import {
  earningsDisclaimerTitle,
  earningsDisclaimerBody,
} from "@/content/legal/earnings-disclaimer";
import {
  affiliateDisclaimerTitle,
  affiliateDisclaimerBody,
} from "@/content/legal/affiliate-disclaimer";
import { dmcaPolicyTitle, dmcaPolicyBody } from "@/content/legal/dmca-policy";
import {
  accessibilityTitle,
  accessibilityBody,
} from "@/content/legal/accessibility";
import { smsTermsTitle, smsTermsBody } from "@/content/legal/sms-terms";
import {
  refundPolicyBody,
} from "@/content/legal/refund-policy";

// Static in-portal legal pages, one route per policy, all rendered through
// the shared LegalDocument layout. The Terms of Service page lives in
// src/pages/TermsOfService.tsx (pre-existing route).

export function PrivacyPolicyPage() {
  return <LegalDocument title={privacyPolicyTitle} body={privacyPolicyBody} />;
}

export function EarningsDisclaimerPage() {
  return (
    <LegalDocument title={earningsDisclaimerTitle} body={earningsDisclaimerBody} />
  );
}

export function AffiliateDisclaimerPage() {
  return (
    <LegalDocument title={affiliateDisclaimerTitle} body={affiliateDisclaimerBody} />
  );
}

export function DmcaPolicyPage() {
  return <LegalDocument title={dmcaPolicyTitle} body={dmcaPolicyBody} />;
}

export function AccessibilityPage() {
  return <LegalDocument title={accessibilityTitle} body={accessibilityBody} />;
}

export function SmsTermsPage() {
  return <LegalDocument title={smsTermsTitle} body={smsTermsBody} />;
}

export function RefundPolicyPage() {
  // The supplied document is titled "Action-Based Refund Guarantee Terms of
  // Service"; the footer (matching the marketing site) labels it Refund Policy.
  return <LegalDocument title="Refund Policy" body={refundPolicyBody} />;
}
