import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { db, usersTable, kbStagingDocsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

// The upload handler reads the uploaded file from object storage and kicks off
// background triage. Both are external side effects we don't want in a unit-style
// test, so we mock them. Everything else — file classification, text/PDF/DOCX
// extraction, and the staging-doc insert — runs for real.
const mockState = vi.hoisted(() => ({
  buffer: Buffer.from("") as Buffer<ArrayBufferLike>,
  triageSpy: vi.fn(async () => {}),
}));

vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile(_objectPath: string) {
      return {
        async download() {
          return [mockState.buffer];
        },
      };
    }
  },
  ObjectNotFoundError: class extends Error {},
}));

vi.mock("../routes/admin/knowledgebase-staging", () => ({
  runTriageBackground: mockState.triageSpy,
}));

const triageSpy = mockState.triageSpy;

import { buildTestAppWithRouters } from "./test-app";
import knowledgebasePipelineRouter from "../routes/admin/knowledgebase-pipeline";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const TEST_TAG = `kb-upload-${randomUUID().slice(0, 8)}`;

const seededUserIds: number[] = [];
const seededTitles: string[] = [];

let app: ReturnType<typeof buildTestAppWithRouters>;
let adminCookie: string;

function buildMinimalPdf(text: string): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  ];
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += String(off).padStart(10, "0") + " 00000 n \n";
  });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function buildMinimalDocx(text: string): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
  );
  zip.addFile(
    "word/document.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ),
  );
  return zip.toBuffer();
}

async function uploadFile(body: Record<string, unknown>) {
  return request(app)
    .post("/api/create-from-upload")
    .set("Cookie", adminCookie)
    .send(body);
}

beforeAll(async () => {
  app = buildTestAppWithRouters([knowledgebasePipelineRouter]);

  const email = `${TEST_TAG}-admin@example.test`;
  const passwordHash = await bcrypt.hash("irrelevant", 4);
  const [row] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Upload Admin",
      passwordHash,
      role: "admin",
      sourceProduct: "lifetime",
      emailVerified: true,
      onboardingComplete: true,
    })
    .returning({ id: usersTable.id });
  seededUserIds.push(row.id);
  const token = jwt.sign({ userId: row.id, email }, JWT_SECRET, { expiresIn: "1h" });
  adminCookie = `access_token=${token}`;
});

afterAll(async () => {
  if (seededTitles.length > 0) {
    await db.delete(kbStagingDocsTable).where(inArray(kbStagingDocsTable.title, seededTitles));
  }
  if (seededUserIds.length > 0) {
    await db.delete(usersTable).where(inArray(usersTable.id, seededUserIds));
  }
});

describe("POST /admin/knowledgebase/pipeline/create-from-upload", () => {
  it("extracts text from a plain-text/markdown upload and stages it with source=upload", async () => {
    const title = `${TEST_TAG}-text`;
    seededTitles.push(title);
    mockState.buffer = Buffer.from("# Heading\n\nThis is plain markdown KB content.", "utf-8");

    const res = await uploadFile({
      objectPath: "/objects/uploads/kb-text.md",
      title,
      category: "strategy",
      audience: "admin",
      originalFilename: "kb-text.md",
      mimeType: "text/markdown",
    });

    expect(res.status).toBe(200);
    expect(res.body.fileType).toBe("text");
    expect(res.body.triagingInBackground).toBe(true);

    const [staged] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.title, [title]));
    expect(staged).toBeDefined();
    expect(staged.source).toBe("upload");
    expect(staged.status).toBe("pending_review");
    expect(staged.title).toBe(title);
    expect(staged.category).toBe("strategy");
    expect(staged.audience).toBe("admin");
    expect(staged.content).toContain("plain markdown KB content");
    expect(staged.sourceObjectPath).toBe("/objects/uploads/kb-text.md");
    expect(triageSpy).toHaveBeenCalled();
  });

  it("extracts text from a PDF upload via pdf-parse", async () => {
    const title = `${TEST_TAG}-pdf`;
    seededTitles.push(title);
    mockState.buffer = buildMinimalPdf("Hello PDF Content For Testing");

    const res = await uploadFile({
      objectPath: "/objects/uploads/kb.pdf",
      title,
      category: "faq",
      audience: "member",
      originalFilename: "kb.pdf",
      mimeType: "application/pdf",
    });

    expect(res.status).toBe(200);
    expect(res.body.fileType).toBe("pdf");

    const [staged] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.title, [title]));
    expect(staged).toBeDefined();
    expect(staged.source).toBe("upload");
    expect(staged.audience).toBe("member");
    expect(staged.content).toContain("Hello PDF Content For Testing");
    expect(staged.adminNotes).toContain("Uploaded PDF");
  });

  it("extracts text from a DOCX upload via mammoth", async () => {
    const title = `${TEST_TAG}-docx`;
    seededTitles.push(title);
    mockState.buffer = buildMinimalDocx("Hello DOCX Content For Testing");

    const res = await uploadFile({
      objectPath: "/objects/uploads/kb.docx",
      title,
      category: "sop",
      audience: "member",
      originalFilename: "kb.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    expect(res.status).toBe(200);
    expect(res.body.fileType).toBe("docx");

    const [staged] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.title, [title]));
    expect(staged).toBeDefined();
    expect(staged.source).toBe("upload");
    expect(staged.category).toBe("sop");
    expect(staged.content).toContain("Hello DOCX Content For Testing");
    expect(staged.adminNotes).toContain("Uploaded DOCX");
  });

  it("stages a placeholder for an unsupported file type", async () => {
    const title = `${TEST_TAG}-unsupported`;
    seededTitles.push(title);
    mockState.buffer = Buffer.from([0x00, 0x01, 0x02, 0x03]);

    const res = await uploadFile({
      objectPath: "/objects/uploads/kb.bin",
      title,
      originalFilename: "kb.bin",
      mimeType: "application/octet-stream",
    });

    expect(res.status).toBe(200);
    expect(res.body.fileType).toBe("unsupported");

    const [staged] = await db
      .select()
      .from(kbStagingDocsTable)
      .where(inArray(kbStagingDocsTable.title, [title]));
    expect(staged).toBeDefined();
    expect(staged.source).toBe("upload");
    // defaults applied when not provided
    expect(staged.category).toBe("faq");
    expect(staged.audience).toBe("member");
    expect(staged.content).toContain("Unsupported file type");
    expect(staged.adminNotes).toContain("unsupported file type");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await uploadFile({
      title: "missing-fields",
      category: "faq",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/objectPath.*originalFilename.*mimeType/);
  });
});
