const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface AssistantQuestion {
  id: number;
  cardId?: number;
  body: string;
  sortOrder?: number;
}

export interface AssistantUpgradeProduct {
  id: number | string;
  name: string;
  priceDisplay: string;
}

export interface AssistantCard {
  id: number;
  groupId?: number;
  title: string;
  icon: string;
  description: string;
  locked: boolean;
  entitlementKey?: string | null;
  sortOrder?: number;
  upgradeProduct: AssistantUpgradeProduct | null;
  questions: AssistantQuestion[];
}

export interface AssistantCardGroup {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  sortOrder?: number;
  cards: AssistantCard[];
}

export async function fetchAssistantCards(): Promise<AssistantCardGroup[]> {
  const res = await fetch(`${API_BASE}/assistant/cards`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch assistant cards: ${res.status}`);
  }
  const data = await res.json();
  return data.groups;
}
