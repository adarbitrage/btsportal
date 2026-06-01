const API_BASE = `${import.meta.env.BASE_URL}api`;

async function blitzFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return res.json();
}

export interface BlitzLessonSummary {
  id: number;
  title: string;
  category: string | null;
  tags: string | null;
  sourceVideoTitle: string | null;
  phase: "build" | "test" | "scale" | null;
  module: string | null;
  lessonId: string | null;
  lessonType: "conceptual" | "technical" | "strategy" | null;
  networkPath: "universal" | "media-mavens" | "clickbank" | null;
  publisherPath: "all" | "caterpillar" | "grasshopper-crane" | null;
  blitzOrder: number | null;
}

export interface BlitzLessonDetail extends BlitzLessonSummary {
  content: string;
  sourceVideoId: string | null;
}

export function fetchBlitzLessons(): Promise<{ lessons: BlitzLessonSummary[] }> {
  return blitzFetch("/blitz/lessons");
}

export function fetchBlitzLesson(id: number): Promise<{ lesson: BlitzLessonDetail }> {
  return blitzFetch(`/blitz/lessons/${id}`);
}
