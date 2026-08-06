import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import {
  fetchAdminSwipeBankOverview,
  createTaxonomyEntry,
  updateTaxonomyEntry,
  deleteTaxonomyEntry,
  uploadSwipeBankAsset,
  registerSwipeBankItem,
  updateSwipeBankItem,
  saveSwipeBankDisclaimer,
  type AdminSwipeBankOverview,
  type SwipeBankItem,
  type TaxonomyLevel,
} from "@/lib/swipe-bank-api";

/**
 * Admin — Swipe Resource Bank (Task #2104): taxonomy manager, item upload +
 * edit/soft-disable, and disclaimer copy editor.
 */

const QUERY_KEY = ["admin-swipe-bank"];

function TaxonomyManager({ data }: { data: AdminSwipeBankOverview }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newNames, setNewNames] = useState<Record<string, string>>({});

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const onError = (err: unknown) =>
    toast({
      title: "Taxonomy change failed",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    });

  const create = useMutation({
    mutationFn: (args: { level: TaxonomyLevel; name: string; verticalId?: number; subVerticalId?: number }) =>
      createTaxonomyEntry(args.level, args),
    onSuccess: invalidate,
    onError,
  });
  const remove = useMutation({
    mutationFn: (args: { level: TaxonomyLevel; id: number }) => deleteTaxonomyEntry(args.level, args.id),
    onSuccess: invalidate,
    onError,
  });
  const rename = useMutation({
    mutationFn: (args: { level: TaxonomyLevel; id: number; name: string }) =>
      updateTaxonomyEntry(args.level, args.id, { name: args.name }),
    onSuccess: invalidate,
    onError,
  });

  const addRow = (key: string, level: TaxonomyLevel, parent?: { verticalId?: number; subVerticalId?: number }) => (
    <div className="flex gap-2 mt-2">
      <Input
        placeholder={`New ${level === "subVertical" ? "sub-vertical" : level}...`}
        value={newNames[key] ?? ""}
        onChange={(e) => setNewNames((s) => ({ ...s, [key]: e.target.value }))}
        className="h-8 text-sm"
        data-testid={`input-new-${key}`}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!(newNames[key] ?? "").trim() || create.isPending}
        onClick={() => {
          create.mutate({ level, name: (newNames[key] ?? "").trim(), ...parent });
          setNewNames((s) => ({ ...s, [key]: "" }));
        }}
        data-testid={`button-add-${key}`}
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Taxonomy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.verticals.map((v) => (
          <div key={v.id} className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2">
              <EditableName
                name={v.name}
                onSave={(name) => rename.mutate({ level: "vertical", id: v.id, name })}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-destructive"
                onClick={() => remove.mutate({ level: "vertical", id: v.id })}
                data-testid={`button-delete-vertical-${v.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="ml-4 mt-2 space-y-2">
              {data.subVerticals
                .filter((s) => s.verticalId === v.id)
                .map((s) => (
                  <div key={s.id}>
                    <div className="flex items-center gap-2">
                      <EditableName
                        name={s.name}
                        onSave={(name) => rename.mutate({ level: "subVertical", id: s.id, name })}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive"
                        onClick={() => remove.mutate({ level: "subVertical", id: s.id })}
                        data-testid={`button-delete-subvertical-${s.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="ml-4 flex flex-wrap items-center gap-2 mt-1">
                      {data.angles
                        .filter((a) => a.subVerticalId === s.id)
                        .map((a) => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 text-xs bg-muted rounded-full px-2 py-0.5"
                          >
                            {a.name}
                            <button
                              type="button"
                              className="text-destructive"
                              onClick={() => remove.mutate({ level: "angle", id: a.id })}
                              data-testid={`button-delete-angle-${a.id}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                    <div className="ml-4">{addRow(`angle-${s.id}`, "angle", { subVerticalId: s.id })}</div>
                  </div>
                ))}
              {addRow(`sub-${v.id}`, "subVertical", { verticalId: v.id })}
            </div>
          </div>
        ))}
        {addRow("vertical", "vertical")}
      </CardContent>
    </Card>
  );
}

function EditableName({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  if (!editing) {
    return (
      <button
        type="button"
        className="text-sm font-medium hover:underline text-left"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
      >
        {name}
      </button>
    );
  }
  return (
    <div className="flex gap-2 items-center">
      <Input value={value} onChange={(e) => setValue(e.target.value)} className="h-7 text-sm w-56" />
      <Button
        size="sm"
        className="h-7"
        onClick={() => {
          if (value.trim() && value.trim() !== name) onSave(value.trim());
          setEditing(false);
        }}
      >
        Save
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </div>
  );
}

function ItemUploader({ data }: { data: AdminSwipeBankOverview }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [itemType, setItemType] = useState<"banner" | "advertorial">("banner");
  const [subVerticalId, setSubVerticalId] = useState<string>("");
  const [angleId, setAngleId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const angles = useMemo(
    () => data.angles.filter((a) => String(a.subVerticalId) === subVerticalId),
    [data.angles, subVerticalId],
  );

  const submit = async () => {
    if (!file || !title.trim() || !subVerticalId) return;
    setBusy(true);
    try {
      const objectPath = await uploadSwipeBankAsset(file);
      await registerSwipeBankItem({
        itemType,
        subVerticalId: Number(subVerticalId),
        angleId: angleId ? Number(angleId) : null,
        title: title.trim(),
        sourceLabel: sourceLabel.trim() || undefined,
        objectPath,
      });
      toast({ title: "Item added", description: `"${title.trim()}" registered.` });
      setFile(null);
      setTitle("");
      setSourceLabel("");
      setAngleId("");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add Item</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
          }}
          data-testid="input-upload-file"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="input-item-title" />
          <Input
            placeholder="Source label (optional)"
            value={sourceLabel}
            onChange={(e) => setSourceLabel(e.target.value)}
            data-testid="input-item-source"
          />
          <Select value={itemType} onValueChange={(v) => setItemType(v as "banner" | "advertorial")}>
            <SelectTrigger data-testid="select-item-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="banner">Banner</SelectItem>
              <SelectItem value="advertorial">Advertorial</SelectItem>
            </SelectContent>
          </Select>
          <Select value={subVerticalId} onValueChange={(v) => { setSubVerticalId(v); setAngleId(""); }}>
            <SelectTrigger data-testid="select-item-subvertical">
              <SelectValue placeholder="Sub-vertical" />
            </SelectTrigger>
            <SelectContent>
              {data.subVerticals.map((s) => {
                const v = data.verticals.find((x) => x.id === s.verticalId);
                return (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {v ? `${v.name} › ` : ""}{s.name}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={angleId} onValueChange={setAngleId} disabled={angles.length === 0}>
            <SelectTrigger data-testid="select-item-angle">
              <SelectValue placeholder={angles.length ? "Angle (optional)" : "No angles"} />
            </SelectTrigger>
            <SelectContent>
              {angles.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={submit} disabled={busy || !file || !title.trim() || !subVerticalId} data-testid="button-upload-item">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          Upload & Register
        </Button>
      </CardContent>
    </Card>
  );
}

function ItemList({ data }: { data: AdminSwipeBankOverview }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const update = useMutation({
    mutationFn: (args: { id: number; body: Parameters<typeof updateSwipeBankItem>[1] }) =>
      updateSwipeBankItem(args.id, args.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (err) =>
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  const subName = (id: number) => data.subVerticals.find((s) => s.id === id)?.name ?? `#${id}`;
  const angleName = (id: number | null) =>
    id === null ? "—" : data.angles.find((a) => a.id === id)?.name ?? `#${id}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Items ({data.items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items yet — upload the first swipe above.</p>
        ) : (
          data.items.map((item: SwipeBankItem) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
              data-testid={`admin-item-${item.id}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {item.itemType} · {subName(item.subVerticalId)} · angle: {angleName(item.angleId)}
                  {item.sourceLabel ? ` · ${item.sourceLabel}` : ""}
                </p>
              </div>
              <Input
                type="number"
                className="h-8 w-20 text-sm"
                defaultValue={item.sortOrder}
                onBlur={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (Number.isInteger(n) && n !== item.sortOrder) {
                    update.mutate({ id: item.id, body: { sortOrder: n } });
                  }
                }}
                data-testid={`input-item-sort-${item.id}`}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Active
                <Switch
                  checked={item.isActive}
                  onCheckedChange={(checked) => update.mutate({ id: item.id, body: { isActive: checked } })}
                  data-testid={`switch-item-active-${item.id}`}
                />
              </label>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function DisclaimerEditor({ data }: { data: AdminSwipeBankOverview }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [topNote, setTopNote] = useState(data.disclaimer.topNote);
  const [heading, setHeading] = useState(data.disclaimer.heading);
  const [body, setBody] = useState(data.disclaimer.paragraphs.join("\n\n"));

  const save = useMutation({
    mutationFn: () =>
      saveSwipeBankDisclaimer({
        topNote: topNote.trim(),
        heading: heading.trim(),
        paragraphs: body
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast({ title: "Disclaimer saved" });
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) =>
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Disclaimer Copy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={topNote} onChange={(e) => setTopNote(e.target.value)} placeholder="Top note" data-testid="input-disclaimer-topnote" />
        <Input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="Heading" data-testid="input-disclaimer-heading" />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="Paragraphs separated by blank lines"
          data-testid="textarea-disclaimer-body"
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-disclaimer">
          {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Save Disclaimer
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AdminSwipeBank() {
  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAdminSwipeBankOverview,
  });

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Swipe Resource Bank</h1>
          <p className="text-sm text-muted-foreground">
            Manage taxonomy, upload swipes, and edit the ownership disclaimer.
          </p>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError || !data ? (
          <p className="text-sm text-destructive">Failed to load Swipe Bank data.</p>
        ) : (
          <>
            <ItemUploader data={data} />
            <ItemList data={data} />
            <TaxonomyManager data={data} />
            <DisclaimerEditor key={JSON.stringify(data.disclaimer)} data={data} />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
