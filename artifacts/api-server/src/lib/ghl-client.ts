const GHL_API_BASE = "https://rest.gohighlevel.com/v1";
const GHL_API_KEY = process.env.GHL_API_KEY || "";
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || "";

interface GHLContactData {
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  phone?: string;
  tags?: string[];
  customField?: Record<string, string>;
  timezone?: string;
}

interface GHLContactResponse {
  contact?: {
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    tags?: string[];
    customFields?: Record<string, string>[];
  };
  contacts?: Array<{
    id: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    tags?: string[];
  }>;
}

interface GHLNoteData {
  contactId: string;
  body: string;
}

interface GHLTaskData {
  contactId: string;
  title: string;
  body?: string;
  dueDate?: string;
}

interface GHLPipelineData {
  contactId: string;
  pipelineId: string;
  stageId: string;
  title?: string;
}

async function ghlRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  if (!GHL_API_KEY) {
    throw new Error("GHL_API_KEY is not configured");
  }

  const url = `${GHL_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${GHL_API_KEY}`,
    "Content-Type": "application/json",
  };

  const options: RequestInit = { method, headers };
  if (body && method !== "GET") {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL API ${method} ${path} failed (${response.status}): ${errorText}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return response.json();
  }
  return {};
}

export async function searchContactByEmail(email: string): Promise<string | null> {
  const result = (await ghlRequest(
    "GET",
    `/contacts/lookup?email=${encodeURIComponent(email)}`
  )) as GHLContactResponse;

  if (result.contacts && result.contacts.length > 0) {
    return result.contacts[0].id;
  }
  return null;
}

export async function createContact(data: GHLContactData): Promise<string> {
  const payload: Record<string, unknown> = {
    locationId: GHL_LOCATION_ID,
    email: data.email,
    firstName: data.firstName || data.name?.split(" ")[0] || "",
    lastName: data.lastName || data.name?.split(" ").slice(1).join(" ") || "",
    phone: data.phone || "",
    tags: data.tags || [],
    timezone: data.timezone || "America/New_York",
  };

  if (data.customField) {
    payload.customField = data.customField;
  }

  const result = (await ghlRequest("POST", "/contacts/", payload)) as GHLContactResponse;
  if (!result.contact?.id) {
    throw new Error("GHL create contact returned no ID");
  }
  return result.contact.id;
}

export async function updateContact(
  contactId: string,
  data: Partial<GHLContactData>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (data.firstName) payload.firstName = data.firstName;
  if (data.lastName) payload.lastName = data.lastName;
  if (data.name) {
    payload.firstName = data.name.split(" ")[0];
    payload.lastName = data.name.split(" ").slice(1).join(" ");
  }
  if (data.phone) payload.phone = data.phone;
  if (data.tags) payload.tags = data.tags;
  if (data.customField) payload.customField = data.customField;
  if (data.timezone) payload.timezone = data.timezone;

  await ghlRequest("PUT", `/contacts/${contactId}`, payload);
}

export async function addTags(contactId: string, tags: string[]): Promise<void> {
  await ghlRequest("POST", `/contacts/${contactId}/tags/`, { tags });
}

export async function removeTags(contactId: string, tags: string[]): Promise<void> {
  await ghlRequest("DELETE", `/contacts/${contactId}/tags/`, { tags });
}

export async function addNote(data: GHLNoteData): Promise<void> {
  await ghlRequest("POST", `/contacts/${data.contactId}/notes/`, {
    body: data.body,
  });
}

export async function createTask(data: GHLTaskData): Promise<void> {
  await ghlRequest("POST", `/contacts/${data.contactId}/tasks/`, {
    title: data.title,
    body: data.body || "",
    dueDate: data.dueDate || new Date(Date.now() + 86400000).toISOString(),
  });
}

export async function movePipeline(data: GHLPipelineData): Promise<void> {
  await ghlRequest("POST", `/contacts/${data.contactId}/opportunities/`, {
    pipelineId: data.pipelineId,
    pipelineStageId: data.stageId,
    title: data.title || "Portal Opportunity",
    status: "open",
  });
}

export async function getContact(contactId: string): Promise<GHLContactResponse | null> {
  try {
    return (await ghlRequest("GET", `/contacts/${contactId}`)) as GHLContactResponse;
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return !!GHL_API_KEY && !!GHL_LOCATION_ID;
}
