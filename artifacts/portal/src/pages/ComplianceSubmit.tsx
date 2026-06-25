import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Send,
  CheckCircle2,
  Upload,
  AlertCircle,
  AlertTriangle,
  X,
  RotateCw,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListTicketsQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  validateTicketAttachment,
  TICKET_ATTACHMENT_MAX_LABEL,
  TICKET_ATTACHMENT_ALLOWED_LABEL,
} from "@workspace/support-config";

const API_BASE = `${import.meta.env.BASE_URL}api`;

const networkOptions = ["ClickBank", "Media Mavens"];
const trafficSources = ["Grasshopper", "Crane", "Caterpillar"];
const shareOptions = ["Yes, I have shared access", "No, I have not shared access"];

// Page-creative wording follows the Affiliate Network; ad/banner wording
// follows the Traffic Source — the same mapping the Concierge form uses.
const pageLabel = (network: string) => (network === "Media Mavens" ? "Advertorial" : "Jump Page");
const creativeLabel = (traffic: string) => (traffic === "Caterpillar" ? "Ad" : "Banner");

// The exact four creative categories compliance reviews, relabeled per the
// chosen network + traffic. Submitted by their relabeled wording so the admin
// ticket records exactly what the member saw.
function buildCreativeOptions(network: string, traffic: string): string[] {
  const creative = creativeLabel(traffic);
  const page = pageLabel(network);
  return [
    `${creative} Images`,
    `${creative} Headlines/Descriptions`,
    `${page} Hero Shot Images`,
    `${page} Headlines`,
  ];
}

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

// The compliance intake form. Reached from the Compliance Review landing page
// via "Submit for Review"; on a successful submit it returns the member to the
// landing (where the new submission now appears under "Currently Under Review")
// and surfaces the reference number as a toast — mirroring the Private Coaching
// book-session flow.
export default function ComplianceSubmit() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [offerName, setOfferName] = useState("");
  const [network, setNetwork] = useState("");
  const [traffic, setTraffic] = useState("");
  const [selectedCreatives, setSelectedCreatives] = useState<string[]>([]);
  // Inline prerequisite warnings (selection order: Network → Traffic → creatives).
  const [networkWarning, setNetworkWarning] = useState(false);
  const [driveLink, setDriveLink] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  // Each selected file is staged with its own upload status + reason so a single
  // failed file can be retried in place (see retryFile) without re-uploading the
  // ones that already succeeded — matching the ticket reply composer.
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // "Is any file still uploading" is derived from the rows so Retry stays in
  // lockstep with the per-row status, matching the ticket reply composer.
  const anyUploading = files.some((sf) => sf.status === "uploading");

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  // The four creative categories appear only once both prerequisites are chosen,
  // relabeled per the network/traffic mapping.
  const creativeOptions = network && traffic ? buildCreativeOptions(network, traffic) : [];

  // Radio-style single-select that never deselects back to empty, and clears the
  // now-stale creative selections so a member can't submit options that don't
  // match their setup — mirroring the Concierge form's clear-on-change behavior.
  const selectNetwork = (n: string) => {
    if (network === n) return;
    setNetwork(n);
    setNetworkWarning(false);
    setSelectedCreatives([]);
  };

  const selectTraffic = (t: string) => {
    if (!network) {
      setNetworkWarning(true);
      return;
    }
    if (traffic === t) return;
    setTraffic(t);
    setSelectedCreatives([]);
  };

  const removeFile = (fileId: string) => {
    setFiles((prev) => prev.filter((sf) => sf.id !== fileId));
  };

  const handleFilesSelected = (selected: File[]) => {
    const error = validateFiles(selected);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setErrorMessage(null);
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

    // Enforce the guided required selections (network → traffic → at least one
    // creative category) before doing any work. The server enforces these too,
    // but this gives instant inline feedback and avoids a wasted upload.
    if (!network) {
      setNetworkWarning(true);
      setErrorMessage("Please select an affiliate network.");
      return;
    }
    if (!traffic) {
      setErrorMessage("Please select a traffic source.");
      return;
    }
    if (selectedCreatives.length === 0) {
      setErrorMessage("Please select at least one creative category.");
      return;
    }

    // Guard again at submit time in case the selection was assembled some other
    // way; the server enforces this regardless, but this avoids a wasted upload.
    const fileError = validateFiles(files.map((sf) => sf.file));
    if (fileError) {
      setErrorMessage(fileError);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

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
          setErrorMessage("Some files didn't upload. Retry or remove them, then submit again.");
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
          offerName,
          affiliateNetwork: network, trafficSource: traffic, selectedCreatives,
          driveLink, shareStatus,
          attachments,
          notes,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === "string" ? data.error : "Failed to submit. Please try again.";
        setErrorMessage(msg);
        return;
      }

      const data = await res.json();
      const ticketNumber: string = data.ticketNumber;
      const confirmationEmailSent = data.confirmationEmailSent !== false;

      // Refresh the landing's submissions list so the new ticket appears under
      // "Currently Under Review" the moment we navigate back.
      queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });

      if (confirmationEmailSent) {
        toast({
          title: "Submission received",
          description: `Reference ${ticketNumber}. We'll review it within 24 hours — don't run the creative until it's approved.`,
        });
      } else {
        toast({
          variant: "destructive",
          title: `Submission received — reference ${ticketNumber}`,
          description:
            "Your creative was logged, but we couldn't send a confirmation email right now. No need to resubmit — note your reference number.",
        });
      }

      navigate("/compliance");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error. Please check your connection and try again.";
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/40";

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm border transition-colors ${
      active
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-background border-border text-muted-foreground hover:border-foreground/40"
    }`;

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <Link href="/compliance">
            <button
              type="button"
              className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              data-testid="compliance-back"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Compliance Review
            </button>
          </Link>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Submit for Review</h1>
          </div>
          <p className="text-muted-foreground">
            Submit your creative below and we'll review it within 24 hours. Please include
            everything we'll need to evaluate the offer, the creative, and the traffic
            source you plan to run it on.
          </p>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-6 md:p-8">
            {errorMessage && (
              <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
                <p>{errorMessage}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Affiliate Network *</label>
                <div className="flex flex-wrap items-center gap-2">
                  {networkOptions.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => selectNetwork(n)}
                      className={chipClass(network === n)}
                      data-testid={`chip-network-${n}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Traffic Source *</label>
                <div className="flex flex-wrap items-center gap-2">
                  {trafficSources.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => selectTraffic(t)}
                      className={chipClass(traffic === t)}
                      data-testid={`chip-traffic-${t}`}
                    >
                      {t}
                    </button>
                  ))}
                  {networkWarning && !network && (
                    <span className="text-xs text-red-600" data-testid="warning-network">
                      Please select an affiliate network first
                    </span>
                  )}
                </div>
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
                <label className="block text-sm font-medium text-foreground mb-1.5">Which creatives are this for? *</label>
                {network && traffic ? (
                  <div className="space-y-2" data-testid="compliance-creatives-group">
                    {creativeOptions.map((opt) => (
                      <label key={opt} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedCreatives.includes(opt)}
                          onChange={() => toggleItem(selectedCreatives, setSelectedCreatives, opt)}
                          className="mt-1 accent-primary"
                          data-testid={`checkbox-creative-${opt}`}
                        />
                        <span className="text-sm text-muted-foreground">{opt}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-red-600" data-testid="warning-creative-prereq">
                    Please select an affiliate network and traffic source first
                  </p>
                )}
              </div>

              <div
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
                data-testid="dual-creative-guidance"
              >
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <p>
                  If you're submitting both your ad/banner creatives and your landing-page
                  (jump page / advertorial) creatives together, please clearly label the
                  folders or documents so we can tell which is which.
                </p>
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
