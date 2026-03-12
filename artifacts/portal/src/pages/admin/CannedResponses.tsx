import { useState, useMemo, useEffect } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2, Search, Eye, Info } from "lucide-react";
import { mockCannedResponses, type CannedResponse } from "@/lib/admin-mock-data";

function ResponseForm({
  open,
  onClose,
  response,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  response?: CannedResponse;
  onSave: (data: { title: string; category: string; body: string; variables: string[] }) => void;
}) {
  const isEditing = !!response;
  const [preview, setPreview] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(response?.title || "");
      setCategory(response?.category || "General");
      setBody(response?.body || "");
      setPreview(false);
    }
  }, [open, response]);

  const previewText = body
    .replace(/\{\{member_name\}\}/g, "John Smith")
    .replace(/\{\{member_email\}\}/g, "john@example.com")
    .replace(/\{\{agent_name\}\}/g, "Sarah Chen")
    .replace(/\{\{ticket_number\}\}/g, "BTS-100234")
    .replace(/\{\{refund_amount\}\}/g, "$20.00")
    .replace(/\{\{sla_hours\}\}/g, "24")
    .replace(/\{\{resolution_summary\}\}/g, "The billing discrepancy was caused by a prorating error. A refund has been issued.");

  const extractVariables = (text: string): string[] => {
    const matches = text.match(/\{\{(\w+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map((m) => m.replace(/\{\{|\}\}/g, "")))];
  };

  const handleSave = () => {
    if (!title.trim() || !body.trim()) return;
    onSave({ title, category, body, variables: extractVariables(body) });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Canned Response" : "Create Canned Response"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the response template." : "Create a reusable response template."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 border rounded-md bg-white text-sm"
                placeholder="e.g., Billing Refund Confirmation"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="General">General</SelectItem>
                  <SelectItem value="Billing">Billing</SelectItem>
                  <SelectItem value="Technical">Technical</SelectItem>
                  <SelectItem value="Account">Account</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Response Body</label>
              <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)}>
                <Eye className="w-3.5 h-3.5 mr-1" /> {preview ? "Edit" : "Preview"}
              </Button>
            </div>
            {preview ? (
              <div className="w-full p-3 border rounded-md bg-secondary/20 text-sm whitespace-pre-wrap min-h-[160px]">{previewText}</div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                className="w-full p-2 border rounded-md bg-white text-sm font-mono"
                placeholder="Hi {{member_name}},\n\nYour response here..."
              />
            )}
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-blue-800">
              <Info className="w-4 h-4" /> Available Variables
            </div>
            <div className="flex flex-wrap gap-2">
              {["member_name", "member_email", "agent_name", "ticket_number", "refund_amount", "sla_hours", "resolution_summary"].map((v) => (
                <code key={v} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 font-mono cursor-pointer hover:bg-blue-200 transition-colors">
                  {`{{${v}}}`}
                </code>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim() || !body.trim()}>
            {isEditing ? "Save Changes" : "Create Response"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CannedResponses() {
  const [responses, setResponses] = useState<CannedResponse[]>(mockCannedResponses);
  const [showForm, setShowForm] = useState(false);
  const [editingResponse, setEditingResponse] = useState<CannedResponse | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");

  const categories = useMemo(() => [...new Set(responses.map((r) => r.category))], [responses]);

  const filterBySearch = (list: CannedResponse[]) => {
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((r) => r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q));
  };

  const handleSave = (data: { title: string; category: string; body: string; variables: string[] }) => {
    if (editingResponse) {
      setResponses((prev) =>
        prev.map((r) => (r.id === editingResponse.id ? { ...r, ...data } : r))
      );
    } else {
      const newId = Math.max(...responses.map((r) => r.id), 0) + 1;
      setResponses((prev) => [...prev, { id: newId, ...data }]);
    }
  };

  const deleteResponse = (id: number) => {
    setResponses((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Canned Responses</h1>
            <p className="text-muted-foreground">Manage reusable response templates for quick ticket replies</p>
          </div>
          <Button
            onClick={() => {
              setEditingResponse(undefined);
              setShowForm(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" /> Add Response
          </Button>
        </div>

        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search responses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-white"
          />
        </div>

        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All ({responses.length})</TabsTrigger>
            {categories.map((cat) => (
              <TabsTrigger key={cat} value={cat}>
                {cat} ({responses.filter((r) => r.category === cat).length})
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="all" className="mt-4">
            <div className="grid gap-4">
              {filterBySearch(responses).map((response) => (
                <ResponseCard
                  key={response.id}
                  response={response}
                  onEdit={() => {
                    setEditingResponse(response);
                    setShowForm(true);
                  }}
                  onDelete={() => deleteResponse(response.id)}
                />
              ))}
            </div>
          </TabsContent>

          {categories.map((cat) => (
            <TabsContent key={cat} value={cat} className="mt-4">
              <div className="grid gap-4">
                {filterBySearch(responses.filter((r) => r.category === cat)).map((response) => (
                  <ResponseCard
                    key={response.id}
                    response={response}
                    onEdit={() => {
                      setEditingResponse(response);
                      setShowForm(true);
                    }}
                    onDelete={() => deleteResponse(response.id)}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <ResponseForm
          open={showForm}
          onClose={() => setShowForm(false)}
          response={editingResponse}
          onSave={handleSave}
        />
      </div>
    </AdminLayout>
  );
}

function ResponseCard({
  response,
  onEdit,
  onDelete,
}: {
  response: CannedResponse;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="font-semibold text-sm">{response.title}</h3>
            <Badge variant="secondary" className="text-[10px]">{response.category}</Badge>
          </div>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-3 mb-2">{response.body}</p>
          {response.variables.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {response.variables.map((v) => (
                <span key={v} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono">{`{{${v}}}`}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
