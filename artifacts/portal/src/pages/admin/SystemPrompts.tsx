import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Plus, Play, Check, Eye } from "lucide-react";
import { fetchSystemPrompts, createSystemPrompt, activateSystemPrompt, previewSystemPrompt } from "@/lib/admin-api";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function SystemPrompts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showEditor, setShowEditor] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [previewResult, setPreviewResult] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [selectedPromptId, setSelectedPromptId] = useState<number | null>(null);

  const { data: prompts, isLoading } = useQuery({
    queryKey: ["admin-system-prompts"],
    queryFn: fetchSystemPrompts,
  });

  const createMutation = useMutation({
    mutationFn: createSystemPrompt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-system-prompts"] });
      setShowEditor(false);
      setName("");
      setContent("");
      toast({ title: "System prompt version created" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create prompt", description: err.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: activateSystemPrompt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-system-prompts"] });
      toast({ title: "System prompt activated" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to activate", description: err.message, variant: "destructive" });
    },
  });

  const handlePreview = async () => {
    if (!content || !testMessage) {
      toast({ title: "Enter prompt content and test message", variant: "destructive" });
      return;
    }
    setPreviewLoading(true);
    setPreviewResult("");
    try {
      const result = await previewSystemPrompt({ content, testMessage });
      setPreviewResult(result.response);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleLoadVersion = (prompt: any) => {
    setName(prompt.name + " (copy)");
    setContent(prompt.content);
    setShowEditor(true);
    setPreviewResult("");
    setSelectedPromptId(prompt.id);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Prompt Management</h1>
            <p className="text-muted-foreground mt-1">Manage and version AI system prompts.</p>
          </div>
          <Button onClick={() => { setShowEditor(!showEditor); setPreviewResult(""); }}>
            <Plus className="w-4 h-4 mr-1" />
            {showEditor ? "Cancel" : "New Version"}
          </Button>
        </div>

        {showEditor && (
          <Card>
            <CardHeader>
              <CardTitle>Create New System Prompt Version</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Version Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., v2 - More concise responses"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Prompt Content</label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter the system prompt..."
                  rows={12}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Variables: {"{{member_name}}"}, {"{{chat_tier}}"}, {"{{daily_limit}}"}
                </p>
              </div>

              <div className="border-t pt-4">
                <label className="text-sm font-medium mb-1 block">Preview with Test Message</label>
                <div className="flex gap-2">
                  <Input
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    placeholder="Enter a test message to preview response..."
                    className="flex-1"
                  />
                  <Button onClick={handlePreview} disabled={previewLoading} variant="secondary">
                    <Eye className="w-4 h-4 mr-1" />
                    {previewLoading ? "Testing..." : "Preview"}
                  </Button>
                </div>
                {previewResult && (
                  <div className="mt-3 p-3 bg-secondary rounded-lg">
                    <p className="text-xs font-medium text-muted-foreground mb-1">AI Response Preview:</p>
                    <div className="text-sm whitespace-pre-wrap">{previewResult}</div>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => createMutation.mutate({ name, content })}
                  disabled={!name || !content || createMutation.isPending}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Save Version
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Version History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading prompts...</div>
            ) : !prompts?.length ? (
              <div className="text-center py-8 text-muted-foreground">No system prompts yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Content Preview</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prompts.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm">v{p.version}</TableCell>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>
                        {p.isActive ? (
                          <Badge className="bg-green-100 text-green-800">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(p.createdAt), "MMM d, yyyy h:mm a")}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                        {p.content.slice(0, 80)}...
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {!p.isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => activateMutation.mutate(p.id)}
                              disabled={activateMutation.isPending}
                            >
                              <Check className="w-3 h-3 mr-1" /> Activate
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleLoadVersion(p)}
                          >
                            <Play className="w-3 h-3 mr-1" /> Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
