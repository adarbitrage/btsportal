const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface AssistantQuestion {
  id: number;
  text: string;
}

export interface AssistantCard {
  id: number;
  label: string;
  icon: string;
  description: string;
  locked: boolean;
  upgrade_product_id?: string;
  upgrade_product_name?: string;
  upgrade_price?: string;
  upgrade_checkout_url?: string;
  questions: AssistantQuestion[];
}

export interface AssistantCardGroup {
  group: string;
  cards: AssistantCard[];
}

export async function fetchAssistantCards(): Promise<AssistantCardGroup[]> {
  const res = await fetch(`${API_BASE}/assistant/cards`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch assistant cards: ${res.status}`);
  }
  return res.json();
}
