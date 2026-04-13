import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { authFetch } from "@/lib/auth";
import { Send, CheckCircle, Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

export default function GeneralSupport() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [firstName, setFirstName] = useState(user?.name?.split(" ")[0] || "");
  const [lastName, setLastName] = useState(user?.name?.split(" ").slice(1).join(" ") || "");
  const [email, setEmail] = useState(user?.email || "");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!firstName.trim() || !email.trim() || !message.trim()) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      const fullName = `${firstName} ${lastName}`.trim();
      const descriptionWithContact = `From: ${fullName} <${email}>\n\n${message}`;
      const res = await authFetch("/tickets", {
        method: "POST",
        body: JSON.stringify({
          category: "other",
          subject: `General Support Request from ${fullName}`,
          description: descriptionWithContact,
        }),
      });

      if (!res.ok) throw new Error("Failed to submit");

      setSubmitted(true);
      toast({ title: "Your message has been sent! We'll reply within 24 hours." });
    } catch {
      toast({ title: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto">
          <Card className="border-border/60 shadow-sm">
            <CardContent className="p-10 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Message Sent!</h2>
                <p className="text-muted-foreground">
                  Thank you for reaching out. We'll get back to you within 24 hours.
                </p>
              </div>
              <div className="flex gap-3 justify-center pt-4">
                <Link href="/support">
                  <Button variant="outline">View My Tickets</Button>
                </Link>
                <Button onClick={() => { setSubmitted(false); setMessage(""); }}>
                  Send Another Message
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <Link href="/support">
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-[#1a56db] transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
            Back to Support Center
          </span>
        </Link>

        <Card className="border-border/60 shadow-sm">
          <CardContent className="p-8 md:p-10">
            <div className="text-center mb-8">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
                Can't Find What You're Looking For?
              </h1>
              <p className="text-muted-foreground text-lg">
                We're here to help. Simply fill out the form below and we will reply within 24 hours.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Name <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First"
                      required
                      className="bg-white"
                    />
                    <p className="text-xs text-muted-foreground mt-1">First</p>
                  </div>
                  <div>
                    <Input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last"
                      className="bg-white"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Last</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  Email <span className="text-red-500">*</span>
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-foreground mb-2">
                  How Can We Assist You Today? <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-muted-foreground mb-2">(Please be as specific and detailed as possible)</p>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  placeholder="Tell us what you need help with..."
                  required
                  className="bg-white resize-none"
                />
              </div>

              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-[#2d8a4e] hover:bg-[#246e3f] text-white font-semibold py-3 text-base"
                size="lg"
              >
                {submitting ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <Send className="w-5 h-5 mr-2" />
                )}
                {submitting ? "Sending..." : "Submit"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
