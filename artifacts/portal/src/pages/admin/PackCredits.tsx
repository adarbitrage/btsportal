import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Search, Ticket } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import {
  useMemberSearch,
  useMemberCreditDetail,
  useGrantCredits,
  type AdminMemberSummary,
} from "@/lib/session-coaching-admin-api";

export default function PackCredits() {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState<AdminMemberSummary | null>(null);
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");

  const { data: results, isLoading: searching } = useMemberSearch(query);
  const { data: detail, isLoading: detailLoading } = useMemberCreditDetail(
    selectedMember?.id ?? null,
  );
  const grantMutation = useGrantCredits();

  async function handleGrant() {
    if (!selectedMember) return;
    const parsed = parseInt(amount, 10);
    if (!Number.isInteger(parsed) || parsed === 0) {
      toast({ title: "Enter a non-zero whole number", variant: "destructive" });
      return;
    }
    try {
      const res = await grantMutation.mutateAsync({
        memberId: selectedMember.id,
        amount: parsed,
        note: note.trim() || undefined,
      });
      toast({
        title: parsed > 0 ? "Credits granted" : "Credits deducted",
        description: `New balance: ${res.balance}`,
      });
      setAmount("1");
      setNote("");
    } catch (err) {
      toast({
        title: "Could not update credits",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-6">
        <p className="text-muted-foreground">Grant or deduct credits and review a member's ledger.</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Member search */}
          <Card className="lg:col-span-1">
            <CardContent className="p-4 space-y-3">
              <Label className="text-xs">Find a member</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Name or email"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {searching && <p className="text-sm text-muted-foreground px-2">Searching…</p>}
                {!searching && query.length >= 2 && (results?.length ?? 0) === 0 && (
                  <p className="text-sm text-muted-foreground px-2">No members found.</p>
                )}
                {(results ?? []).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setSelectedMember(m)}
                    data-testid={`member-result-${m.id}`}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedMember?.id === m.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary"
                    }`}
                  >
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Detail + grant */}
          <div className="lg:col-span-2 space-y-6">
            {!selectedMember ? (
              <Card>
                <CardContent className="p-12 text-center text-muted-foreground">
                  Select a member to manage their session credits.
                </CardContent>
              </Card>
            ) : (
              <>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-foreground">{selectedMember.name}</h3>
                        <p className="text-sm text-muted-foreground">{selectedMember.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Ticket className="w-5 h-5 text-primary" />
                        <span className="text-2xl font-bold text-primary" data-testid="member-balance">
                          {detailLoading ? "—" : detail?.balance ?? 0}
                        </span>
                        <span className="text-xs text-muted-foreground">credits</span>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-3 items-end">
                      <div>
                        <Label className="text-xs">Amount (+/-)</Label>
                        <Input
                          type="number"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          data-testid="grant-amount"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Note (optional)</Label>
                        <Input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="Reason for adjustment"
                        />
                      </div>
                      <Button
                        onClick={handleGrant}
                        disabled={grantMutation.isPending}
                        data-testid="grant-submit"
                      >
                        {grantMutation.isPending ? "Saving…" : "Apply"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-border">
                      <h3 className="font-semibold text-foreground">Credit Ledger</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="p-3 font-medium">When</th>
                            <th className="p-3 font-medium">Reason</th>
                            <th className="p-3 font-medium">Note</th>
                            <th className="p-3 font-medium text-right">Change</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail?.ledger ?? []).length === 0 ? (
                            <tr>
                              <td colSpan={4} className="p-6 text-center text-muted-foreground">
                                No credit history yet.
                              </td>
                            </tr>
                          ) : (
                            (detail?.ledger ?? []).map((entry) => (
                              <tr key={entry.id} className="border-b border-border/50">
                                <td className="p-3 text-muted-foreground">
                                  {format(new Date(entry.createdAt), "MMM d, yyyy h:mm a")}
                                </td>
                                <td className="p-3 text-foreground">{entry.reason.replace(/_/g, " ")}</td>
                                <td className="p-3 text-muted-foreground">{entry.note ?? "—"}</td>
                                <td className="p-3 text-right">
                                  <Badge variant={entry.delta > 0 ? "secondary" : "outline"}>
                                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                                  </Badge>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
    </div>
  );
}
