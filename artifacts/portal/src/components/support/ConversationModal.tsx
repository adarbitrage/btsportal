import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { User, Loader2, Download, FileText, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  useGetTicket,
  useAddTicketMessage,
  getGetTicketQueryKey,
  getListTicketsQueryKey,
} from "@workspace/api-client-react";
import {
  getPreviewTicketDetail,
  isPreviewTicketId,
  appendPreviewReply,
} from "@/lib/supportPreview";

// A calm view of a submission's conversation thread. Both the Compliance Review
// and Concierge submission views open this in place. For items that don't need
// the member to act (Under Review / In Progress and Completed) it's a read-only
// thread. For "Action Needed" items it additionally shows a TEXT-ONLY reply box
// (no uploads) so the member can respond without leaving the submissions view.

type ConversationMessage = {
  id: number;
  senderType: string;
  body: string;
  createdAt: string;
  isInternal?: boolean;
};

type ConversationAttachment = {
  id: number;
  fileName?: string | null;
  fileSize?: number | null;
  messageId?: number | null;
};

function formatFileSize(fileSize: number | null | undefined): string | null {
  if (fileSize == null) return null;
  return fileSize < 1024 * 1024
    ? `${Math.round(fileSize / 1024)} KB`
    : `${(fileSize / (1024 * 1024)).toFixed(1)} MB`;
}

// One attachment as a quiet download link pointing at the owner-scoped download
// endpoint (the same route the full ticket page uses).
function AttachmentLink({
  ticketId,
  att,
}: {
  ticketId: number;
  att: ConversationAttachment;
}) {
  const fileName = att.fileName ?? `attachment-${att.id}`;
  const sizeLabel = formatFileSize(att.fileSize);
  const href = `${import.meta.env.BASE_URL}api/tickets/${ticketId}/attachments/${att.id}/download`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors max-w-full"
      data-testid={`conversation-attachment-${att.id}`}
      title={fileName}
    >
      <FileText className="w-3 h-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{fileName}</span>
      {sizeLabel && <span className="text-muted-foreground shrink-0">· {sizeLabel}</span>}
      <Download className="w-3 h-3 shrink-0 text-primary" />
    </a>
  );
}

function ConversationBody({
  ticketId,
  teamLabel,
  teamIcon,
}: {
  ticketId: number;
  teamLabel: string;
  teamIcon: ReactNode;
}) {
  const preview = getPreviewTicketDetail(ticketId);
  const { data, isLoading: isFetching } = useGetTicket(ticketId, {
    query: { enabled: preview == null, queryKey: getGetTicketQueryKey(ticketId) },
  });
  const ticket = preview ?? data;
  const isLoading = preview == null && isFetching;

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading the conversation…
      </div>
    );
  }

  // Show the real conversation: the member's own messages and the team's
  // non-internal replies, oldest first so it reads like a thread. Internal admin
  // notes never surface to the member.
  const messages = ((ticket?.messages ?? []) as ConversationMessage[])
    .filter((m) => !m.isInternal)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  if (messages.length === 0) {
    return (
      <div
        className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground"
        data-testid="conversation-empty"
      >
        There are no messages in this conversation yet.
      </div>
    );
  }

  const attachments = (ticket?.attachments ?? []) as ConversationAttachment[];
  const attachmentsFor = (messageId: number) =>
    attachments.filter((att) => att.messageId === messageId);
  // Attachments uploaded at submission time often aren't linked to a message;
  // surface them under the conversation so nothing shared is hidden.
  const unlinkedAttachments = attachments.filter((att) => att.messageId == null);

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      {messages.map((m) => {
        const fromMember = m.senderType === "member";
        const messageAttachments = attachmentsFor(m.id);
        return (
          <div
            key={m.id}
            className={`rounded-lg border p-4 ${fromMember ? "border-border bg-muted/20" : "border-primary/30 bg-primary/[0.03]"}`}
            data-testid={`conversation-message-${m.id}`}
          >
            <div className="flex items-center gap-2 mb-2 text-xs">
              {fromMember ? (
                <User className="w-3.5 h-3.5 text-muted-foreground" />
              ) : (
                teamIcon
              )}
              <span className="font-medium text-foreground">
                {fromMember ? "You" : teamLabel}
              </span>
              <span className="ml-auto text-muted-foreground">
                {format(new Date(m.createdAt), "MMM d, yyyy")}
              </span>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{m.body}</p>
            {messageAttachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {messageAttachments.map((att) => (
                  <AttachmentLink key={att.id} ticketId={ticketId} att={att} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {unlinkedAttachments.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Files you shared</p>
          <div className="flex flex-wrap gap-1.5">
            {unlinkedAttachments.map((att) => (
              <AttachmentLink key={att.id} ticketId={ticketId} att={att} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The TEXT-ONLY reply box shown for "Action Needed" submissions (Option A): a
// textarea + Send, no upload controls. For a real ticket it posts via the API
// and refreshes the thread; for a preview ticket (negative id) it appends to the
// in-memory preview store so the respond flow demos end-to-end before the API is
// wired. `onPreviewAppended` lets the modal re-render the thread after a preview
// reply (there's no query to invalidate in that case).
function ReplyBox({
  ticketId,
  teamLabel,
  onPreviewAppended,
}: {
  ticketId: number;
  teamLabel: string;
  onPreviewAppended: () => void;
}) {
  const [text, setText] = useState("");
  const queryClient = useQueryClient();
  const addMessage = useAddTicketMessage();
  const isPreview = isPreviewTicketId(ticketId);
  const sending = addMessage.isPending;

  const handleSend = () => {
    const body = text.trim();
    if (!body || sending) return;

    if (isPreview) {
      appendPreviewReply(ticketId, body);
      setText("");
      onPreviewAppended();
      return;
    }

    addMessage.mutate(
      { id: ticketId, data: { body } },
      {
        onSuccess: () => {
          setText("");
          queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
          queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        },
      },
    );
  };

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2" data-testid="conversation-reply">
      <label
        htmlFor="conversation-reply-input"
        className="text-xs font-medium text-muted-foreground"
      >
        Reply to the {teamLabel}
      </label>
      <Textarea
        id="conversation-reply-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your reply…"
        rows={3}
        disabled={sending}
        data-testid="conversation-reply-input"
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!text.trim() || sending}
          data-testid="conversation-reply-send"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Send className="w-4 h-4 mr-2" />
          )}
          Send Reply
        </Button>
      </div>
    </div>
  );
}

export function ConversationModal({
  ticketId,
  title,
  teamLabel,
  teamIcon,
  allowReply = false,
  onClose,
}: {
  // The ticket whose conversation to show; null closes the dialog.
  ticketId: number | null;
  title: string;
  teamLabel: string;
  teamIcon: ReactNode;
  // When true (Action Needed rows), show the text-only reply box below the thread.
  allowReply?: boolean;
  onClose: () => void;
}) {
  // Bumped after a preview reply so the thread re-renders with the new message
  // (preview tickets have no query to invalidate). Keyed with ticketId so the
  // thread remounts cleanly when a different submission is opened.
  const [replyBump, setReplyBump] = useState(0);

  return (
    <Dialog open={ticketId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="conversation-modal">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {allowReply
              ? `Your conversation with the ${teamLabel}. Reply below to keep things moving.`
              : `Your conversation with the ${teamLabel}. This is a read-only view — open the full ticket to reply.`}
          </DialogDescription>
        </DialogHeader>
        {ticketId != null && (
          <>
            <ConversationBody
              key={`${ticketId}-${replyBump}`}
              ticketId={ticketId}
              teamLabel={teamLabel}
              teamIcon={teamIcon}
            />
            {allowReply && (
              <ReplyBox
                ticketId={ticketId}
                teamLabel={teamLabel}
                onPreviewAppended={() => setReplyBump((b) => b + 1)}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
