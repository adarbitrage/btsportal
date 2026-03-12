import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Key, Plus, Copy, Trash2, Shield, Eye, Clock } from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface ApiKeyItem {
  id: number;
  name: string;
  prefix: string;
  type: string;
  environment: string;
  permissions: string[];
  rateLimitTier: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
  createdAt: string;
}

const PERMISSIONS = [
  "members:read", "members:write",
  "training:read", "training:write",
  "coaching:read", "coaching:write",
  "tickets:read", "tickets:write",
  "announcements:read", "announcements:write",
  "community:read", "community:write",
  "products:read", "products:write",
  "analytics:read",
  "*",
];

async function apiFetch(path: string, options?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
}

export default function AdminApiKeys() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyType, setNewKeyType] = useState("secret");
  const [newKeyTier, setNewKeyTier] = useState("standard");
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>(["*"]);
  const [creating, setCreating] = useState(false);

  if (!user || user.role !== "admin") {
    return <Redirect to="/" />;
  }

  useEffect(() => {
    loadKeys();
  }, []);

  async function loadKeys() {
    try {
      const res = await apiFetch("/admin/api-keys");
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys);
      }
    } catch (err) {
      toast({ title: "Error", description: "Failed to load API keys", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function createKey() {
    setCreating(true);
    try {
      const res = await apiFetch("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: newKeyName,
          type: newKeyType,
          permissions: newKeyPermissions,
          rateLimitTier: newKeyTier,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key.plainTextKey);
        setNewKeyName("");
        setNewKeyType("secret");
        setNewKeyTier("standard");
        setNewKeyPermissions(["*"]);
        loadKeys();
        toast({ title: "API Key Created", description: "Copy the key now — it won't be shown again." });
      } else {
        const data = await res.json();
        toast({ title: "Error", description: data.error?.message || "Failed to create key", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to create API key", variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: number) {
    try {
      const res = await apiFetch(`/admin/api-keys/${id}/revoke`, { method: "POST" });
      if (res.ok) {
        toast({ title: "Key Revoked" });
        loadKeys();
      }
    } catch {
      toast({ title: "Error", description: "Failed to revoke key", variant: "destructive" });
    }
  }

  function togglePermission(perm: string) {
    setNewKeyPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  const activeKeys = keys.filter((k) => !k.revoked);
  const revokedKeys = keys.filter((k) => k.revoked);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">API Keys</h1>
            <p className="text-muted-foreground mt-1">Manage API keys for third-party integrations</p>
          </div>
          <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) setCreatedKey(null); }}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" /> Create API Key</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              {createdKey ? (
                <>
                  <DialogHeader>
                    <DialogTitle>API Key Created</DialogTitle>
                    <DialogDescription>Copy this key now. It will not be shown again.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <code className="flex-1 p-3 bg-muted rounded text-sm font-mono break-all">{createdKey}</code>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard.writeText(createdKey);
                          toast({ title: "Copied to clipboard" });
                        }}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={() => { setCreateOpen(false); setCreatedKey(null); }}>Done</Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                    <DialogDescription>Create a new API key for external integrations.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium">Name</label>
                      <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g., Zapier Integration" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium">Type</label>
                        <Select value={newKeyType} onValueChange={setNewKeyType}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="secret">Secret (Full Access)</SelectItem>
                            <SelectItem value="publishable">Publishable (Read-Only)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Rate Limit</label>
                        <Select value={newKeyTier} onValueChange={setNewKeyTier}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="standard">Standard (60/min)</SelectItem>
                            <SelectItem value="elevated">Elevated (300/min)</SelectItem>
                            <SelectItem value="unlimited">Unlimited</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Permissions</label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {PERMISSIONS.map((perm) => (
                          <Badge
                            key={perm}
                            variant={newKeyPermissions.includes(perm) ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() => togglePermission(perm)}
                          >
                            {perm}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                    <Button onClick={createKey} disabled={!newKeyName.trim() || creating}>
                      {creating ? "Creating..." : "Create Key"}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : activeKeys.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Key className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold">No API Keys</h3>
              <p className="text-muted-foreground mt-1">Create your first API key to enable third-party integrations.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeKeys.map((k) => (
              <Card key={k.id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{k.name}</span>
                      <Badge variant={k.type === "secret" ? "default" : "secondary"}>
                        {k.type === "secret" ? <Shield className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                        {k.type}
                      </Badge>
                      <Badge variant="outline">{k.rateLimitTier}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <code className="text-xs bg-muted px-2 py-0.5 rounded">{k.prefix}...</code>
                      <span>Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {k.lastUsedAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Last used {new Date(k.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(k.permissions as string[]).map((p) => (
                        <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                      ))}
                    </div>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => revokeKey(k.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Revoke
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {revokedKeys.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-muted-foreground">Revoked Keys</h2>
            {revokedKeys.map((k) => (
              <Card key={k.id} className="opacity-60">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold line-through">{k.name}</span>
                      <Badge variant="destructive">Revoked</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <code className="text-xs bg-muted px-2 py-0.5 rounded">{k.prefix}...</code>
                      <span className="ml-4">Revoked {k.revokedAt ? new Date(k.revokedAt).toLocaleDateString() : ""}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
