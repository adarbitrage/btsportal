import { useState, useEffect } from "react";
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
import { GripVertical, Plus, Pencil, Trash2, Power, PowerOff } from "lucide-react";
import { mockRoutingRules, type RoutingRule } from "@/lib/admin-mock-data";
import { cn } from "@/lib/utils";

type RuleFormData = {
  name: string;
  condition: string;
  conditionValue: string;
  assignTo: string;
  priority: string;
};

function RuleForm({
  open,
  onClose,
  rule,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  rule?: RoutingRule;
  onSave: (data: RuleFormData) => void;
}) {
  const isEditing = !!rule;
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("category");
  const [conditionValue, setConditionValue] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [priority, setPriority] = useState("normal");

  useEffect(() => {
    if (open) {
      setName(rule?.name || "");
      setCondition(rule?.condition || "category");
      setConditionValue(rule?.conditionValue || "");
      setAssignTo(rule?.assignTo || "");
      setPriority(rule?.priority || "normal");
    }
  }, [open, rule]);

  const handleSave = () => {
    if (!name.trim() || !conditionValue.trim() || !assignTo) return;
    onSave({ name, condition, conditionValue, assignTo, priority });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Rule" : "Create Rule"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update the routing rule configuration." : "Define a new auto-routing rule for incoming tickets."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Rule Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded-md bg-white text-sm"
              placeholder="e.g., VIP Priority Routing"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">When</label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="category">Category is</SelectItem>
                <SelectItem value="tier">Tier is</SelectItem>
                <SelectItem value="priority">Priority is</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Value</label>
            <input
              type="text"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              className="w-full p-2 border rounded-md bg-white text-sm"
              placeholder="e.g., billing, vip, urgent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Assign To</label>
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger><SelectValue placeholder="Select agent" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Sarah Chen">Sarah Chen</SelectItem>
                <SelectItem value="Mike Johnson">Mike Johnson</SelectItem>
                <SelectItem value="Lisa Wang">Lisa Wang</SelectItem>
                <SelectItem value="James Rodriguez">James Rodriguez</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Set Priority</label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="urgent">Urgent</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!name.trim() || !conditionValue.trim() || !assignTo}>
            {isEditing ? "Save Changes" : "Create Rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function RoutingRules() {
  const [rules, setRules] = useState<RoutingRule[]>(mockRoutingRules);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<RoutingRule | undefined>(undefined);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleSave = (data: RuleFormData) => {
    if (editingRule) {
      setRules((prev) =>
        prev.map((r) => (r.id === editingRule.id ? { ...r, ...data } : r))
      );
    } else {
      const newId = Math.max(...rules.map((r) => r.id), 0) + 1;
      const newOrder = rules.length + 1;
      setRules((prev) => [...prev, { id: newId, ...data, enabled: true, order: newOrder }]);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newRules = [...rules];
    const [dragged] = newRules.splice(draggedIndex, 1);
    newRules.splice(index, 0, dragged);
    setRules(newRules.map((r, i) => ({ ...r, order: i + 1 })));
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const toggleEnabled = (id: number) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const deleteRule = (id: number) => {
    setRules((prev) => prev.filter((r) => r.id !== id).map((r, i) => ({ ...r, order: i + 1 })));
  };

  const conditionLabels: Record<string, string> = {
    category: "Category",
    tier: "Tier",
    priority: "Priority",
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Routing Rules</h1>
            <p className="text-muted-foreground">Configure auto-routing for incoming tickets. Rules are evaluated in order.</p>
          </div>
          <Button
            onClick={() => {
              setEditingRule(undefined);
              setShowForm(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" /> Add Rule
          </Button>
        </div>

        <Card>
          <div className="divide-y divide-border">
            <div className="grid grid-cols-[40px_1fr_160px_140px_140px_120px_100px] gap-3 px-4 py-2.5 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <div></div>
              <div>Rule</div>
              <div>Condition</div>
              <div>Value</div>
              <div>Assign To</div>
              <div>Status</div>
              <div>Actions</div>
            </div>
            {rules.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No routing rules configured.</div>
            ) : (
              rules.map((rule, index) => (
                <div
                  key={rule.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={() => handleDrop(index)}
                  onDragEnd={() => {
                    setDraggedIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={cn(
                    "grid grid-cols-[40px_1fr_160px_140px_140px_120px_100px] gap-3 px-4 py-3 items-center transition-all",
                    !rule.enabled && "opacity-50",
                    draggedIndex === index && "opacity-30",
                    dragOverIndex === index && "bg-primary/5 border-t-2 border-t-primary"
                  )}
                >
                  <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                    <GripVertical className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{rule.name}</div>
                    <div className="text-xs text-muted-foreground">Order: {rule.order}</div>
                  </div>
                  <div>
                    <span className="text-xs bg-secondary px-2 py-0.5 rounded">{conditionLabels[rule.condition] || rule.condition} is</span>
                  </div>
                  <div>
                    <Badge variant="secondary" className="text-[10px]">{rule.conditionValue}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">{rule.assignTo}</div>
                  <div>
                    <button
                      onClick={() => toggleEnabled(rule.id)}
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors",
                        rule.enabled
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      )}
                    >
                      {rule.enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
                      {rule.enabled ? "Active" : "Disabled"}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setEditingRule(rule);
                        setShowForm(true);
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => deleteRule(rule.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <RuleForm
          open={showForm}
          onClose={() => setShowForm(false)}
          rule={editingRule}
          onSave={handleSave}
        />
      </div>
    </AdminLayout>
  );
}
