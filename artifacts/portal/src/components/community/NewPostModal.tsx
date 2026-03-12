import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreatePost, useCommunityCategories } from "@/hooks/use-community";
import { AlertCircle, ImagePlus } from "lucide-react";

interface NewPostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategoryId?: number;
}

export function NewPostModal({ open, onOpenChange, defaultCategoryId }: NewPostModalProps) {
  const [categoryId, setCategoryId] = useState<number>(defaultCategoryId ?? 0);
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const { data: categories } = useCommunityCategories();
  const createPost = useCreatePost();

  useEffect(() => {
    if (defaultCategoryId !== undefined) {
      setCategoryId(defaultCategoryId);
    }
  }, [defaultCategoryId]);

  const bodyLength = body.length;
  const isValid = categoryId > 0 && bodyLength >= 10 && bodyLength <= 5000;

  const handleSubmit = () => {
    if (!isValid) return;

    createPost.mutate(
      {
        categoryId,
        title: body.slice(0, 100),
        body,
        imageUrl: imageUrl || undefined,
      },
      {
        onSuccess: () => {
          setBody("");
          setImageUrl("");
          setCategoryId(defaultCategoryId ?? 0);
          onOpenChange(false);
        },
      }
    );
  };

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setBody("");
      setImageUrl("");
      setCategoryId(defaultCategoryId ?? 0);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Post</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="post-category">Category</Label>
            <select
              id="post-category"
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              className="w-full mt-1.5 p-2 border rounded-md bg-white text-sm"
            >
              <option value={0}>Select a category...</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="post-body">What's on your mind?</Label>
            <Textarea
              id="post-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share your thoughts, wins, questions..."
              className="mt-1.5 min-h-[150px] resize-y"
              maxLength={5000}
            />
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[11px] text-muted-foreground">
                Supports basic markdown formatting
              </p>
              <p className={`text-[11px] ${bodyLength > 4800 ? "text-destructive" : "text-muted-foreground"}`}>
                {bodyLength}/5000
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="post-image" className="flex items-center gap-1.5">
              <ImagePlus className="w-3.5 h-3.5" />
              Image URL (optional)
            </Label>
            <Input
              id="post-image"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="mt-1.5"
            />
          </div>

          <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
            <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Be respectful and constructive. No spam, self-promotion, or offensive content.
              Posts that violate community guidelines may be removed.
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || createPost.isPending}>
            {createPost.isPending ? "Posting..." : "Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
