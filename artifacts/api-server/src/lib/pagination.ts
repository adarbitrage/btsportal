export interface PaginationParams {
  limit: number;
  cursor: string | null;
  sort: "asc" | "desc";
}

export interface PaginationResult<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    previousCursor: string | null;
    total: number;
  };
}

export function parsePaginationParams(query: Record<string, unknown>): PaginationParams {
  let limit = 20;
  if (query.limit) {
    const parsed = parseInt(String(query.limit), 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  const cursor = typeof query.cursor === "string" && query.cursor ? query.cursor : null;
  const sort = query.sort === "asc" ? "asc" : "desc";

  return { limit, cursor, sort };
}

export function encodeCursor(id: number | string, timestamp?: string): string {
  const payload = timestamp ? `${id}:${timestamp}` : String(id);
  return Buffer.from(payload).toString("base64url");
}

export function decodeCursor(cursor: string): { id: string; timestamp?: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
  const parts = decoded.split(":");
  return {
    id: parts[0],
    timestamp: parts[1],
  };
}

export function buildPaginationResult<T>(
  data: T[],
  total: number,
  limit: number,
  getCursorValue: (item: T) => { id: number | string; timestamp?: string },
  previousCursorValue?: string | null,
): PaginationResult<T> {
  const hasMore = data.length > limit;
  const items = hasMore ? data.slice(0, limit) : data;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = getCursorValue(items[items.length - 1]);
    nextCursor = encodeCursor(last.id, last.timestamp);
  }

  return {
    data: items,
    pagination: {
      hasMore,
      nextCursor,
      previousCursor: previousCursorValue || null,
      total,
    },
  };
}
