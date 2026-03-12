import { useState, useRef, useEffect } from "react";
import { Send, Square, Paperclip, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SavedPrompt } from "@/lib/chat-api";

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isStreaming: boolean;
  disabled: boolean;
  disabledMessage?: string;
  savedPrompts?: SavedPrompt[];
  showSavedPrompts?: boolean;
  compact?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  disabledMessage,
  savedPrompts,
  showSavedPrompts,
  compact,
}: ChatInputProps) {
  const [message, setMessage] = useState("");
  const [showPrompts, setShowPrompts] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (promptsRef.current && !promptsRef.current.contains(e.target as Node)) {
        setShowPrompts(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, compact ? 100 : 150) + "px";
    }
  }, [message, compact]);

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled || isStreaming) return;
    onSend(trimmed);
    setMessage("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePromptSelect = (prompt: SavedPrompt) => {
    setMessage(prompt.content);
    setShowPrompts(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative">
      {disabled && disabledMessage && (
        <div className="text-center text-sm text-muted-foreground bg-secondary/50 rounded-lg px-3 py-2 mb-2">
          {disabledMessage}
        </div>
      )}
      <div className={`flex items-end gap-2 bg-white border border-border rounded-xl px-3 py-2 ${disabled ? "opacity-60" : ""} transition-all focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20`}>
        <button
          className="p-1.5 text-muted-foreground/40 cursor-not-allowed shrink-0 mb-0.5"
          title="File upload coming soon"
          disabled
        >
          <Paperclip className="w-4 h-4" />
        </button>

        {showSavedPrompts && savedPrompts && savedPrompts.length > 0 && (
          <div className="relative shrink-0 mb-0.5" ref={promptsRef}>
            <button
              onClick={() => setShowPrompts(!showPrompts)}
              className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Saved prompts"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            {showPrompts && (
              <div className="absolute bottom-full left-0 mb-2 w-64 bg-white border border-border rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
                <div className="p-2 border-b border-border">
                  <p className="text-xs font-medium text-muted-foreground">Saved Prompts</p>
                </div>
                {savedPrompts.map((prompt) => (
                  <button
                    key={prompt.id}
                    onClick={() => handlePromptSelect(prompt)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50 transition-colors border-b border-border/30 last:border-0"
                  >
                    <p className="font-medium text-foreground text-xs">{prompt.title}</p>
                    <p className="text-muted-foreground text-xs truncate mt-0.5">{prompt.content}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Chat limit reached" : "Type your message..."}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none py-1.5 min-h-[36px]"
        />

        {isStreaming ? (
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0 h-8 w-8 text-destructive hover:text-destructive mb-0.5"
            onClick={onStop}
          >
            <Square className="w-4 h-4 fill-current" />
          </Button>
        ) : (
          <Button
            size="icon"
            className="shrink-0 h-8 w-8 mb-0.5"
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
