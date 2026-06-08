import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import path from "path";

import {
  getSystemPrompt,
  reloadKnowledgeBase,
} from "../routes/openai/knowledge-base";

// The static prompt files the assistant folds into its system prompt. These are
// the exact files getSystemPrompt() reads from src/knowledge-base. Planting a
// forbidden full name into them and asserting the rendered prompt only keeps the
// first name pins the privacy scrub that runs at load/reload time — if a future
// refactor drops scrubPrivateContent() from the load path, this test fails.
const KB_DIR = path.join(process.cwd(), "src/knowledge-base");
const QA_FILE = path.join(KB_DIR, "qa-articles.txt");
const GLOSSARY_FILE = path.join(KB_DIR, "glossary.txt");

// A coach whose surname must never reach the prompt. Bruce Clark -> "Bruce".
const FORBIDDEN_FULL_NAME = "Bruce Clark";
const ALLOWED_FIRST_NAME = "Bruce";
const FORBIDDEN_SURNAME = "Clark";

// Unique marker so we can locate the planted line and prove our content was the
// content actually rendered (not some pre-existing coincidental "Bruce").
const MARKER = "PRIVACY_SCRUB_PROBE_4F2A";

const qaOriginal = fs.readFileSync(QA_FILE, "utf-8");
const glossaryOriginal = fs.readFileSync(GLOSSARY_FILE, "utf-8");

function restoreSources() {
  fs.writeFileSync(QA_FILE, qaOriginal, "utf-8");
  fs.writeFileSync(GLOSSARY_FILE, glossaryOriginal, "utf-8");
  // Re-load from the pristine on-disk content so other tests / later runs see a
  // clean cache.
  reloadKnowledgeBase();
}

afterAll(() => {
  restoreSources();
});

describe("assistant system prompt — static knowledge-base privacy scrub", () => {
  it("strips a coach surname planted in qa-articles.txt, keeping only the first name", () => {
    try {
      fs.writeFileSync(
        QA_FILE,
        `${qaOriginal}\n\n${MARKER}: Ask ${FORBIDDEN_FULL_NAME} about campaign reviews.\n`,
        "utf-8",
      );
      reloadKnowledgeBase();

      const prompt = getSystemPrompt();

      // Our planted marker must be present so we know we're inspecting the
      // content we wrote, not a coincidental match elsewhere in the prompt.
      expect(prompt).toContain(MARKER);

      const probeLine = prompt
        .split("\n")
        .find((line) => line.includes(MARKER));
      expect(probeLine).toBeDefined();
      expect(probeLine).toContain(ALLOWED_FIRST_NAME);
      expect(probeLine).not.toContain(FORBIDDEN_FULL_NAME);
      // The bare surname must not survive on the planted line either.
      expect(probeLine).not.toContain(FORBIDDEN_SURNAME);
    } finally {
      restoreSources();
    }
  });

  it("strips a coach surname planted in glossary.txt, keeping only the first name", () => {
    try {
      fs.writeFileSync(
        GLOSSARY_FILE,
        `${glossaryOriginal}\n\n${MARKER}: ${FORBIDDEN_FULL_NAME} leads the live calls.\n`,
        "utf-8",
      );
      reloadKnowledgeBase();

      const prompt = getSystemPrompt();

      expect(prompt).toContain(MARKER);

      const probeLine = prompt
        .split("\n")
        .find((line) => line.includes(MARKER));
      expect(probeLine).toBeDefined();
      expect(probeLine).toContain(ALLOWED_FIRST_NAME);
      expect(probeLine).not.toContain(FORBIDDEN_FULL_NAME);
      expect(probeLine).not.toContain(FORBIDDEN_SURNAME);
    } finally {
      restoreSources();
    }
  });

  it("re-scrubs on reloadKnowledgeBase() after the source file changes", () => {
    try {
      // First load: pristine sources, no probe marker present.
      reloadKnowledgeBase();
      expect(getSystemPrompt()).not.toContain(MARKER);

      // Mutate the source on disk *after* the initial load, then reload. A
      // reload that forgot to re-run the scrub would surface the raw surname.
      fs.writeFileSync(
        QA_FILE,
        `${qaOriginal}\n\n${MARKER}: Coach ${FORBIDDEN_FULL_NAME} hosts office hours.\n`,
        "utf-8",
      );
      reloadKnowledgeBase();

      const prompt = getSystemPrompt();
      const probeLine = prompt
        .split("\n")
        .find((line) => line.includes(MARKER));
      expect(probeLine).toBeDefined();
      expect(probeLine).toContain(ALLOWED_FIRST_NAME);
      expect(probeLine).not.toContain(FORBIDDEN_SURNAME);
    } finally {
      restoreSources();
    }
  });
});
