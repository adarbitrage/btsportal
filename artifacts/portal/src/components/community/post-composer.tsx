import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useCreatePost, useCommunityCategories } from "@/hooks/use-community";
import { AuthorAvatar } from "./ProfilePopover";
import { ImagePlus, AlertCircle, Send } from "lucide-react";

interface PostComposerProps {
  defaultCategoryId?: number;
  onSuccess?: () => void;
}

export function PostComposer({ defaultCategoryId, onSuccess }: PostComposerProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState<number>(defaultCategoryId ?? 0);
  const { data: categories } = useCommunityCategories();
  const createPost = useCreatePost();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (defaultCategoryId !== undefined) {
      setCategoryId(defaultCategoryId);
    }
  }, [defaultCategoryId]);

  const bodyLength = body.length;
  const isValid = categoryId > 0 && bodyLength >= 10 && bodyLength <= 5000;

  const handleExpand = () => {
    setExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    setExpanded(false);
    setBody("");
    setImageUrl("");
    setCategoryId(defaultCategoryId ?? 0);
  };

  const handleSubmit = () => {
    if (!isValid) return;
    createPost.mutate(
      { categoryId, title: body.slice(0, 100), body, imageUrl: imageUrl || undefined },
      {
        onSuccess: () => {
          setBody("");
          setImageUrl("");
          setCategoryId(defaultCategoryId ?? 0);
          setExpanded(false);
          onSuccess?.();
        },
      }
    );
  };

  const authorForAvatar = user
    ? { id: user.id, name: user.name, avatarUrl: null, highestProductSlug: "", badges: [] }
    : null;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-4">
        {!expanded ? (
          <div
            className="flex items-center gap-3 cursor-pointer"
            onClick={handleExpand}
            data-composer-prompt
          >
            {authorForAvatar && <AuthorAvatar author={authorForAvatar} size="md" />}
            <div className="flex-1 bg-muted/60 hover:bg-muted rounded-full px-4 py-2.5 text-sm text-muted-foreground transition-colors">
              What's on your mind?
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              {authorForAvatar && <AuthorAvatar author={authorForAvatar} size="md" />}
              <div className="flex-1 space-y-3">
                <div>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(Number(e.target.value))}
                    className="w-full p-2 border rounded-md bg-white text-sm mb-2.5"
                  >
                    <option value={0}>Select a category...</option>
                    {categories?.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Share your thoughts, wins, questions..."
                    className="min-h-[120px] resize-y text-sm"
                    maxLength={5000}
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-[11px] text-muted-foreground">Supports markdown formatting</p>
                    <p className={`text-[11px] ${bodyLength > 4800 ? "text-destructive" : "text-muted-foreground"}`}>
                      {bodyLength}/5000
                    </p>
                  </div>
                </div>
                <div>
                  <Label htmlFor="composer-image" className="flex items-center gap-1.5 text-xs mb-1.5">
                    <ImagePlus className="w-3.5 h-3.5" />
                    Image URL (optional)
                  </Label>
                  <Input
                    id="composer-image"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="text-sm h-8"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-border/30">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Be respectful and constructive. No spam or offensive content.
              </div>
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!isValid || createPost.isPending}
                className="gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                {createPost.isPending ? "Posting..." : "Post"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
