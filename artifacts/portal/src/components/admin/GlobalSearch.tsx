import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, User, Ticket, MessageSquare, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { adminPanelApi } from "@/lib/admin-panel-api";

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) { setResults(null); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await adminPanelApi.search(q);
        setResults(data);
        setOpen(true);
      } catch { }
      setLoading(false);
    }, 300);
  };

  const goTo = (path: string) => {
    navigate(path);
    setOpen(false);
    setQuery("");
    setResults(null);
  };

  const hasResults = results && (results.members?.length > 0 || results.tickets?.length > 0 || results.posts?.length > 0);

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => search(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search members, tickets, posts..."
          className="pl-10 pr-8 h-9 bg-muted/50 border-0 focus:bg-white focus:border focus:border-border"
        />
        {query && (
          <button onClick={() => { setQuery(""); setResults(null); setOpen(false); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground text-center">Searching...</div>
          ) : !hasResults ? (
            <div className="p-4 text-sm text-muted-foreground text-center">No results found</div>
          ) : (
            <div className="divide-y">
              {results.members?.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Members</p>
                  {results.members.map((m: any) => (
                    <button key={m.id} onClick={() => goTo(m.matchedPreviousEmail ? `/admin/members/${m.id}?highlightOldEmail=${encodeURIComponent(m.matchedPreviousEmail)}` : `/admin/members/${m.id}`)} className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50 text-left transition-colors">
                      <User className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                        {m.matchedPreviousEmail && (
                          <p className="text-xs text-muted-foreground truncate italic">Previously: {m.matchedPreviousEmail}</p>
                        )}
                        {m.matchedPreviousPhone && (
                          <p className="text-xs text-muted-foreground truncate italic">Previously: {m.matchedPreviousPhone}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">{m.role}</Badge>
                    </button>
                  ))}
                </div>
              )}
              {results.tickets?.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Tickets</p>
                  {results.tickets.map((t: any) => (
                    <button key={t.id} onClick={() => goTo(`/admin/tickets/${t.id}`)} className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50 text-left transition-colors">
                      <Ticket className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{t.subject}</p>
                        <p className="text-xs text-muted-foreground">#{t.ticketNumber}</p>
                      </div>
                      <Badge variant={t.status === "open" ? "default" : "secondary"} className="text-[10px] shrink-0">{t.status}</Badge>
                    </button>
                  ))}
                </div>
              )}
              {results.posts?.length > 0 && (
                <div className="p-2">
                  <p className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase">Community Posts</p>
                  {results.posts.map((p: any) => (
                    <button key={p.id} onClick={() => goTo(`/community`)} className="w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-muted/50 text-left transition-colors">
                      <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                      <p className="text-sm truncate">{p.title}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
