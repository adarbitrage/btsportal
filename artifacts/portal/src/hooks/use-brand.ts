import { useGetCurrentMember, type BrandStrings } from "@workspace/api-client-react";

const BTS_DEFAULTS: BrandStrings = {
  full: "Build Test Scale\u2122",
  short: "BTS",
  possessive: "Build Test Scale's",
  shortPossessive: "BTS'",
};

export function useBrand(): BrandStrings {
  const { data: member } = useGetCurrentMember();
  return member?.brand ?? BTS_DEFAULTS;
}
