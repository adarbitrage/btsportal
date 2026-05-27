import { useState, useRef, KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";

interface MessageComposerProps {
  onSend: (body: string) => void;
  isPending?: boolean;
}

export function MessageComposer({ onSend, isPending = false }: MessageComposerProps) {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = body.trim().length > 0 && !isPending;

  function handleSend() {
    if (!canSend) return;
    onSend(body.trim());
    setBody("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t bg-background p-3">
      <Textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message… (Cmd+Enter to send)"
        className="flex-1 min-h-[2.75rem] max-h-40 resize-none"
        rows={1}
        disabled={isPending}
      />
      <Button
        onClick={handleSend}
        disabled={!canSend}
        size="icon"
        className="shrink-0"
        aria-label="Send message"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
}
