import { Router, type IRouter } from "express";
import { db, legalDocumentsTable, signedDocumentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { GetLegalDocumentsResponse } from "@workspace/api-zod";
import { SignDocumentBody, SignDocumentResponse } from "@workspace/api-zod/schemas";

const router: IRouter = Router();

router.get("/documents", async (req, res): Promise<void> => {
  const typeFilter = req.query.type as string | undefined;

  let docs;
  if (typeFilter) {
    docs = await db
      .select()
      .from(legalDocumentsTable)
      .where(eq(legalDocumentsTable.type, typeFilter))
      .orderBy(desc(legalDocumentsTable.version));
  } else {
    docs = await db
      .select()
      .from(legalDocumentsTable)
      .orderBy(legalDocumentsTable.type, desc(legalDocumentsTable.version));
  }

  res.json(
    GetLegalDocumentsResponse.parse(
      docs.map((d) => ({
        id: d.id,
        type: d.type,
        version: d.version,
        title: d.title,
        content: d.content,
      }))
    )
  );
});

router.post("/documents/sign", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = SignDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { documentType, documentVersion, signature } = parsed.data;

  const [doc] = await db
    .select()
    .from(legalDocumentsTable)
    .where(
      and(eq(legalDocumentsTable.type, documentType), eq(legalDocumentsTable.version, documentVersion))
    );

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const existingSig = await db
    .select()
    .from(signedDocumentsTable)
    .where(
      and(
        eq(signedDocumentsTable.userId, userId),
        eq(signedDocumentsTable.documentType, documentType),
        eq(signedDocumentsTable.documentVersion, documentVersion)
      )
    );

  if (existingSig.length > 0) {
    res.status(400).json({ error: "Document already signed" });
    return;
  }

  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    null;

  const [signed] = await db
    .insert(signedDocumentsTable)
    .values({
      userId,
      documentType,
      documentVersion,
      signature,
      ipAddress,
    })
    .returning();

  // TODO: Generate PDF of signed document and store in Cloudflare R2
  // TODO: Send signed document via email using SendGrid
  // TODO: Sync signing event to GHL contact

  res.json(
    SignDocumentResponse.parse({
      id: signed.id,
      documentType: signed.documentType,
      signedAt: signed.signedAt.toISOString(),
    })
  );
});

export default router;
