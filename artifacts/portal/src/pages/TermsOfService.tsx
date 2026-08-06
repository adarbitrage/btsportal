import { LegalDocument } from "@/components/legal/LegalDocument";
import {
  termsOfServiceTitle,
  termsOfServiceBody,
} from "@/content/legal/terms-of-service";

// Read-only "browsewrap" view of the platform Terms of Service — reachable
// from the portal footer link. No signature is collected here; the onboarding
// signing gate that used to live on this content was removed (Task #1625).
// Content is the static user-supplied copy (effective Oct 1, 2025), rendered
// through the same LegalDocument layout as the other footer legal pages.
export default function TermsOfService() {
  return <LegalDocument title={termsOfServiceTitle} body={termsOfServiceBody} />;
}
