import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useCreatePost, useCommunityCategories } from "@/hooks/use-community";
import { AuthorAvatar } from "./ProfilePopover";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, Send } from "lucide-react";

interface PostComposerProps {
  defaultCategoryId?: number;
  onSuccess?: () => void;
}

export function PostComposer({ defaultCategoryId, onSuccess }: PostComposerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState<number>(defaultCategoryId ?? 0);
  const { data: categories } = useCommunityCategories();
  const createPost = useCreatePost();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (defaultCategoryId !== undefined) {
      setCategoryId(defaultCategoryId);
    }
  }, [defaultCategoryId]);

  const titleLength = title.length;
  const bodyLength = body.length;
  const isValid =
    categoryId > 0 &&
    titleLength >= 1 &&
    titleLength <= 120 &&
    bodyLength >= 1 &&
    bodyLength <= 5000;

  const handleExpand = () => {
    setExpanded(true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };

  const handleCancel = () => {
    setExpanded(false);
    setTitle("");
    setBody("");
    setCategoryId(defaultCategoryId ?? 0);
  };

  const handleSubmit = () => {
    if (!isValid || createPost.isPending) return;
    createPost.mutate(
      { categoryId, title: title.trim(), body },
      {
        onSuccess: () => {
          setTitle("");
          setBody("");
          setCategoryId(defaultCategoryId ?? 0);
          setExpanded(false);
          onSuccess?.();
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: "Failed to post",
            description: err?.message ?? "Something went wrong. Please try again.",
          });
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
                  <Label htmlFor="composer-title" className="text-xs mb-1.5 block">
                    Title <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="composer-title"
                    ref={titleRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Give your post a title..."
                    maxLength={120}
                    className="text-sm"
                  />
                  <p className={`text-[11px] mt-1 text-right ${titleLength > 110 ? "text-destructive" : "text-muted-foreground"}`}>
                    {titleLength}/120
                  </p>
                </div>
                <div>
                  <Label htmlFor="composer-body" className="text-xs mb-1.5 block">
                    Body <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="composer-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Share your thoughts, wins, questions..."
                    className="min-h-[120px] resize-y text-sm"
                    maxLength={5000}
                  />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[11px] text-muted-foreground">Supports markdown formatting</p>
                    <p className={`text-[11px] ${bodyLength > 4800 ? "text-destructive" : "text-muted-foreground"}`}>
                      {bodyLength}/5000
                    </p>
                  </div>
                </div>
                <div>
                  <Label className="text-xs mb-1.5 block">
                    Category <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={categoryId > 0 ? String(categoryId) : ""}
                    onValueChange={(val) => setCategoryId(Number(val))}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select a category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories?.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-border/30">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground flex-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Be respectful and constructive. No spam or offensive content.
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancel}>
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
