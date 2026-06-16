import { db, productsTable } from "@workspace/db";
import { getSupportTicketLimit, getHighestProductLabel } from "./src/lib/entitlements";

async function main() {
  const products = await db.select().from(productsTable).orderBy(productsTable.sortOrder);
  const PRD: Record<string, string[]> = {
    reserve_income: ["content:frontend","support:basic","chat:basic"],
    backroad: ["content:frontend","support:basic","chat:basic"],
    offmarket: ["content:frontend","support:basic","chat:basic"],
    launchpad: ["content:frontend","content:advanced","software:base","support:standard","chat:full"],
    "3month": ["content:frontend","content:advanced","software:base","coaching:group","community:access","commissions:entry","support:enhanced","chat:full"],
    "6month": ["content:frontend","content:advanced","software:base","software:expanded","coaching:group","coaching:mastermind","community:access","commissions:mid","support:unlimited","chat:full"],
    "1year": ["content:frontend","content:advanced","software:base","software:expanded","coaching:group","coaching:mastermind","community:access","commissions:premium","support:unlimited","chat:full"],
    lifetime: ["content:frontend","content:advanced","software:base","software:expanded","coaching:group","coaching:mastermind","community:access","commissions:top","support:vip","chat:custom","access:lifetime"],
  };
  console.log("\n--- DB vs PRD per product ---");
  for (const p of products) {
    const dbKeys = (Array.isArray(p.entitlementKeys) ? p.entitlementKeys as string[] : []).slice().sort();
    const exp = (PRD[p.slug] || []).slice().sort();
    const ok = JSON.stringify(dbKeys) === JSON.stringify(exp);
    console.log(`${p.slug.padEnd(15)} | db=${dbKeys.length} expected=${exp.length} | ${ok ? "PASS" : "FAIL"}`);
    if (!ok) {
      const m = exp.filter(k => !dbKeys.includes(k));
      const e = dbKeys.filter(k => !exp.includes(k));
      if (m.length) console.log("  MISSING:", m.join(", "));
      if (e.length) console.log("  EXTRA:  ", e.join(", "));
    }
  }
  console.log("\n--- Per-tier behavior (single-product user) ---");
  for (const p of products) {
    const ents = new Set(Array.isArray(p.entitlementKeys) ? p.entitlementKeys as string[] : []);
    const ticketLimit = getSupportTicketLimit(ents);
    const label = getHighestProductLabel(ents);
    const chatTier = ents.has("chat:custom") ? "chat:custom" : ents.has("chat:full") ? "chat:full" : ents.has("chat:basic") ? "chat:basic" : "none";
    const has = (k: string) => ents.has(k) ? "Y" : ".";
    const hasComm = [...ents].some(k => k.startsWith("commissions:")) ? "Y" : ".";
    console.log(`${p.slug.padEnd(15)} label=${label.slug.padEnd(10)} chat=${chatTier.padEnd(11)} tickets=${String(ticketLimit).padStart(3)} adv=${has("content:advanced")} sw=${has("software:base")} sw+=${has("software:expanded")} grp=${has("coaching:group")} mast=${has("coaching:mastermind")} comm=${hasComm} community=${has("community:access")}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
