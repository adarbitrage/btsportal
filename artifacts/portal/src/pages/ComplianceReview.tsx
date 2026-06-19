import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Send, CheckCircle2, Upload, AlertCircle, AlertTriangle, X, RotateCw, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import {
  validateTicketAttachment,
  TICKET_ATTACHMENT_MAX_LABEL,
  TICKET_ATTACHMENT_ALLOWED_LABEL,
} from "@workspace/support-config";

const API_BASE = `${import.meta.env.BASE_URL}api`;

const creativeTypes = ["Banner", "Landing Page"];
const trafficSources = ["Grasshopper", "Crane", "Caterpillar", "Meta", "Other"];
const shareOptions = ["Yes, I have shared access", "No, I have not shared access"];

// Per-file size and content-type are enforced by the SHARED
// `validateTicketAttachment` (the exact rules the ticket reply composer uses),
// so both intake paths stay consistent. These two aggregate caps mirror the
// server-side guards in api-server/src/lib/attachment-validation.ts that the
// shared per-file validator doesn't cover. The server is the authority; these
// give the member instant feedback so they don't wait through a long upload
// only to be rejected.
const MAX_FILES = 100;
const MAX_TOTAL_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB per submission
const FILE_ACCEPT = "image/*,application/pdf,.zip,application/zip";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

// Returns an error message if the selected files break a limit, else null.
function validateFiles(files: File[]): string | null {
  if (files.length > MAX_FILES) {
    return `Too many files. You can upload at most ${MAX_FILES} files (you selected ${files.length}).`;
  }
  let total = 0;
  for (const f of files) {
    const perFileError = validateTicketAttachment({
      fileName: f.name,
      fileSize: f.size,
      contentType: f.type,
    });
    if (perFileError) return perFileError;
    total += f.size;
  }
  if (total > MAX_TOTAL_SIZE_BYTES) {
    return `Your files total ${formatBytes(total)}, which exceeds the ${formatBytes(MAX_TOTAL_SIZE_BYTES)} limit.`;
  }
  return null;
}

type AttachmentMeta = {
  objectPath: string;
  fileName: string;
  fileSize: number;
  contentType: string;
};

type UploadStatus = "pending" | "uploading" | "uploaded" | "failed";

// Mirrors the ticket reply composer's StagedFile model so each file carries its
// own upload status, stored metadata and failure reason. Keying retries off a
// stable id (not the array index) lets a single failed file be re-uploaded
// without re-running the ones that already succeeded — and without the
// index-shift hazard that forced the old per-index error map to be cleared on
// every removal.
type StagedFile = {
  id: string;
  file: File;
  status: UploadStatus;
  meta?: AttachmentMeta;
  error?: string;
};

let stagedFileSeq = 0;
const nextStagedFileId = () => `compliance-staged-${Date.now()}-${stagedFileSeq++}`;

// Mirrors the ticket reply composer's upload flow (TicketDetail.tsx) so both
// intake paths surface the same human-readable failure reasons: a network
// error (couldn't reach the server / connection dropped mid-upload) reads
// differently from a storage rejection (the server or object store returned a
// non-OK status).
async function uploadFileToStorage(file: File): Promise<AttachmentMeta> {
  let metaRes: Response;
  try {
    metaRes = await fetch(`${API_BASE}/storage/uploads/request-url`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
    });
  } catch {
    throw new Error("Network error — couldn't reach the server. Check your connection and retry.");
  }
  if (!metaRes.ok) {
    throw new Error(`Couldn't prepare the upload (server error ${metaRes.status}). Retry in a moment.`);
  }
  const { uploadURL, objectPath } = await metaRes.json();
  let putRes: Response;
  try {
    putRes = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
  } catch {
    throw new Error("Network error during upload — check your connection and retry.");
  }
  if (!putRes.ok) {
    throw new Error(`Storage rejected the file (error ${putRes.status}). Retry in a moment.`);
  }
  return { objectPath: objectPath as string, fileName: file.name, fileSize: file.size, contentType: file.type };
}

export default function ComplianceReview() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [offerName, setOfferName] = useState("");
  const [selectedCreatives, setSelectedCreatives] = useState<string[]>([]);
  const [selectedTraffic, setSelectedTraffic] = useState<string[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  // Each selected file is staged with its own upload status + reason so a single
  // failed file can be retried in place (see retryFile) without re-uploading the
  // ones that already succeeded — matching the ticket reply composer.
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<
    | { kind: "success"; ticketNumber: string; confirmationEmailSent: boolean }
    | { kind: "error"; message: string }
    | null
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // "Is any file still uploading" is derived from the rows so Retry stays in
  // lockstep with the per-row status, matching the ticket reply composer.
  const anyUploading = files.some((sf) => sf.status === "uploading");

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((sf) => sf.id !== fileId));
  };

  const handleFilesSelected = (selected: File[]) => {
    const error = validateFiles(selected);
    if (error) {
      setSubmitResult({ kind: "error", message: error });
      return;
    }
    setSubmitResult(null);
    setFiles(selected.map((file) => ({ id: nextStagedFileId(), file, status: "pending" })));
  };

  // Upload a single staged file, returning the row with its final status so the
  // caller can write it back into state. Shared by submit and Retry so both
  // behave identically.
  const uploadOne = async (target: StagedFile): Promise<StagedFile> => {
    try {
      const meta = await uploadFileToStorage(target.file);
      return { ...target, status: "uploaded", meta, error: undefined };
    } catch (err) {
      return {
        ...target,
        status: "failed",
        error: err instanceof Error ? err.message : `Upload failed for ${target.file.name}`,
      };
    }
  };

  // Flip a staged file to "uploading", push it to object storage, then write
  // back its final status. Guards against the row vanishing (removed mid-upload).
  const startUpload = async (target: StagedFile) => {
    setFiles((prev) => prev.map((sf) => (sf.id === target.id ? { ...sf, status: "uploading", error: undefined } : sf)));
    const result = await uploadOne(target);
    setFiles((prev) => prev.map((sf) => (sf.id === target.id ? result : sf)));
  };

  // Re-upload only the one failed file. Disabled (no-op) while any upload is in
  // flight so the in-flight set stays well-defined, matching the ticket composer.
  const retryFile = async (fileId: string) => {
    const target = files.find((sf) => sf.id === fileId);
    if (!target || target.status === "uploading") return;
    await startUpload(target);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Guard again at submit time in case the selection was assembled some other
    // way; the server enforces this regardless, but this avoids a wasted upload.
    const fileError = validateFiles(files.map((sf) => sf.file));
    if (fileError) {
      setSubmitResult({ kind: "error", message: fileError });
      return;
    }

    setSubmitting(true);
    setSubmitResult(null);

    try {
      // Upload only the files that aren't already in object storage — a file the
      // member successfully retried before resubmitting is reused as-is.
      const pending = files.filter((sf) => sf.status !== "uploaded");
      let working = files;
      if (pending.length > 0) {
        setFiles((prev) => prev.map((sf) => (sf.status !== "uploaded" ? { ...sf, status: "uploading", error: undefined } : sf)));
        const results = await Promise.all(pending.map(uploadOne));
        const byId = new Map(results.map((r) => [r.id, r]));
        working = files.map((sf) => byId.get(sf.id) ?? sf);
        setFiles(working);
        // If any file failed, hold the submit and surface it per-row so the
        // member can retry/remove the offending files individually.
        if (working.some((sf) => sf.status === "failed")) {
          setSubmitResult({
            kind: "error",
            message: "Some files didn't upload. Retry or remove them, then submit again.",
          });
          return;
        }
      }

      const attachments: AttachmentMeta[] = working
        .map((sf) => sf.meta)
        .filter((meta): meta is AttachmentMeta => Boolean(meta));

      const res = await fetch(`${API_BASE}/tickets/compliance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName, lastName, email, offerName,
          selectedCreatives, selectedTraffic,
          driveLink, shareStatus,
          attachments,
          notes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === "string" ? data.error : "Failed to submit. Please try again.";
        setSubmitResult({ kind: "error", message: msg });
        return;
      }

      const data = await res.json();
      setSubmitResult({
        kind: "success",
        ticketNumber: data.ticketNumber,
        confirmationEmailSent: data.confirmationEmailSent !== false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error. Please check your connection and try again.";
      setSubmitResult({ kind: "error", message: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/40";

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm border transition-colors ${
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-background border-border text-muted-foreground hover:border-foreground/40"
    }`;

  if (submitResult?.kind === "success") {
    return (
      <AppLayout>
        <div className="space-y-6 max-w-6xl">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold">Compliance Review</h1>
            </div>
            <p className="text-muted-foreground">
              Submit your creative for review before running it on any traffic source.
            </p>
          </div>

          <Card className="border-border/60">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-700" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Submission Received</h2>
              <p className="text-muted-foreground">
                Your creative has been submitted for compliance review under reference{" "}
                <span className="font-mono font-semibold text-foreground" data-testid="text-ticket-number">{submitResult.ticketNumber}</span>.
                We'll review it within 24 hours. Do <strong>not</strong> run the creative until you receive approval.
                {submitResult.confirmationEmailSent ? " Check your email for a confirmation." : ""}
              </p>
              {!submitResult.confirmationEmailSent && (
                <div
                  className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 text-left"
                  data-testid="alert-confirmation-email-failed"
                >
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-amber-600" />
                  <p>
                    Your submission was logged successfully, but we couldn't send a confirmation
                    email right now. No need to resubmit — note your reference number above, and
                    our team will still receive your creative for review.
                  </p>
                </div>
              )}
              <Button
                onClick={() => {
                  setSubmitResult(null);
                  setFirstName(""); setLastName(""); setEmail(""); setOfferName("");
                  setSelectedCreatives([]); setSelectedTraffic([]); setDriveLink("");
                  setShareStatus(""); setFiles([]); setNotes("");
                }}
                variant="outline"
                className="mt-4"
              >
                Submit Another Creative
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Compliance Review</h1>
          </div>
          <p className="text-muted-foreground">
            Submit your creative below and we'll review it within 24 hours. Please include
            everything we'll need to evaluate the offer, the creative, and the traffic
            source you plan to run it on.
          </p>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-6 md:p-8">
            {submitResult?.kind === "error" && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
                <p>{submitResult.message}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">First Name *</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={inputClass}
                    data-testid="input-first-name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={inputClass}
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  data-testid="input-email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Name Of The Offer You Are Promoting *</label>
                <input
                  type="text"
                  required
                  value={offerName}
                  onChange={(e) => setOfferName(e.target.value)}
                  className={inputClass}
                  data-testid="input-offer-name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Which creative is this for? *</label>
                <div className="flex flex-wrap gap-2">
                  {creativeTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleItem(selectedCreatives, setSelectedCreatives, t)}
                      className={chipClass(selectedCreatives.includes(t))}
                      data-testid={`chip-creative-${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Which traffic source will you be using these creatives for? *</label>
                <div className="flex flex-wrap gap-2">
                  {trafficSources.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleItem(selectedTraffic, setSelectedTraffic, t)}
                      className={chipClass(selectedTraffic.includes(t))}
                      data-testid={`chip-traffic-${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Google Drive Link To Your Creative Folder
                </label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  If you don't have a Google Drive link, you can upload a zip file below.
                </p>
                <input
                  type="url"
                  value={driveLink}
                  onChange={(e) => setDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className={inputClass}
                  data-testid="input-drive-link"
                />
              </div>

              {driveLink && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Have you shared access with the Concierge Team?
                  </label>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    Failure to share proper access will delay completion of this task.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {shareOptions.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setShareStatus(opt)}
                        className={chipClass(shareStatus === opt)}
                        data-testid={`chip-share-${opt}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Upload Your Creative Zip File</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                  data-testid="dropzone-files"
                >
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {files.length > 0 ? `${files.length} file(s) selected` : "Drag & drop files or click to browse"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Up to {MAX_FILES} files — {TICKET_ATTACHMENT_ALLOWED_LABEL} — max {TICKET_ATTACHMENT_MAX_LABEL} each
                  </p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept={FILE_ACCEPT}
                  onChange={(e) => handleFilesSelected(Array.from(e.target.files || []))}
                  className="hidden"
                />
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1" data-testid="compliance-files-list">
                    {files.map((sf, i) => (
                      <li
                        key={sf.id}
                        data-testid={`compliance-file-${i}`}
                        data-status={sf.status}
                        className="text-xs bg-muted/40 rounded px-2 py-1"
                      >
                        <div className="flex items-center justify-between gap-2 text-muted-foreground">
                          <span className="truncate max-w-xs">{sf.file.name}</span>
                          <span className="flex items-center gap-2 shrink-0">
                            {sf.status === "uploading" && (
                              <span className="flex items-center gap-1 text-blue-600" data-testid={`compliance-file-status-${i}`}>
                                <Loader2 className="w-3 h-3 animate-spin" /> Uploading…
                              </span>
                            )}
                            {sf.status === "uploaded" && (
                              <span className="flex items-center gap-1 text-green-600" data-testid={`compliance-file-status-${i}`}>
                                <CheckCircle2 className="w-3 h-3" /> Uploaded
                              </span>
                            )}
                            {sf.status === "failed" && (
                              <>
                                <span
                                  className="flex items-center gap-1 text-destructive"
                                  data-testid={`compliance-file-status-${i}`}
                                >
                                  <AlertTriangle className="w-3 h-3" /> Failed
                                </span>
                                <button
                                  type="button"
                                  onClick={() => retryFile(sf.id)}
                                  disabled={anyUploading}
                                  className="flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
                                  data-testid={`compliance-file-retry-${i}`}
                                >
                                  <RotateCw className="w-3 h-3" /> Retry
                                </button>
                              </>
                            )}
                            {sf.status !== "uploading" && (
                              <button
                                type="button"
                                onClick={() => removeFile(sf.id)}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`Remove ${sf.file.name}`}
                                data-testid={`compliance-file-remove-${i}`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </span>
                        </div>
                        {sf.status === "failed" && sf.error && (
                          <p
                            className="mt-1 text-destructive"
                            role="alert"
                            data-testid={`compliance-file-error-${i}`}
                          >
                            <span className="sr-only">Upload failed: </span>
                            {sf.error}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Anything Else You Would Like Us To Know?
                </label>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Please be as specific and detailed as possible..."
                  className={`${inputClass} resize-none`}
                  data-testid="input-notes"
                />
              </div>

              <Button
                type="submit"
                className="gap-2 w-full sm:w-auto"
                isLoading={submitting}
                disabled={submitting}
                data-testid="button-submit"
              >
                <Send className="w-4 h-4" />
                {submitting ? "Uploading & Submitting…" : "Submit For Review"}
              </Button>

            </form>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
