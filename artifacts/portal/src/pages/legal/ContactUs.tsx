import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useCreateTicket } from "@workspace/api-client-react";
import { Loader2, Mail, MapPin, MessageCircle, Send } from "lucide-react";

// In-portal Contact Us page (linked from the footer), mirroring the
// buildtestscale.com contact page: "Send us a Message" form, Contact
// Information card, FAQ callout, and the Contact Page Terms and Conditions.
// Copy is from the user-supplied contact text/screenshot.

const SUPPORT_EMAIL = "support@buildtestscale.com";

// The TicketDesk widget only exposes setSection() programmatically; its
// launcher bubble lives in a shadow root attached to a fixed host div on
// document.body. Clicking the bubble is the supported user path — we
// replicate that click. Returns false when the widget isn't loaded.
export function openSupportChat(): boolean {
  const hosts = document.querySelectorAll("body > div");
  for (const host of Array.from(hosts)) {
    const root = (host as HTMLElement).shadowRoot;
    const bubble = root?.querySelector<HTMLElement>(".bubble");
    if (bubble) {
      bubble.click();
      return true;
    }
  }
  return false;
}

export default function ContactUs() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const { toast } = useToast();

  // Submitting the form opens a real support ticket through the member
  // ticket API (the portal's existing support/ticket flow).
  const createTicket = useCreateTicket({
    mutation: {
      onSuccess: () => {
        setMessage("");
        toast({
          title: "Message sent",
          description: "Our team will get back to you within 24-48 hours.",
        });
      },
      onError: () => {
        toast({
          title: "Could not send your message",
          description: `Please try again, or email ${SUPPORT_EMAIL}.`,
          variant: "destructive",
        });
      },
    },
  });

  const sendMessage = () => {
    if (!message.trim()) {
      toast({ title: "Please enter a message first.", variant: "destructive" });
      return;
    }
    const contactLine = [name.trim(), email.trim()].filter(Boolean).join(" — ");
    createTicket.mutate({
      data: {
        category: "other",
        subject: name.trim() ? `Contact form message from ${name.trim()}` : "Contact form message",
        description: contactLine ? `${message}\n\nSubmitted by: ${contactLine}` : message,
        source: "contact_us_page",
      },
    });
  };

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground" data-testid="legal-page-title">
            Contact Us
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            We're here to help. Reach out to us with any questions or concerns.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Send us a Message */}
          <Card>
            <CardContent className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Send us a Message</h2>
                <p className="text-sm text-muted-foreground">
                  Fill out the form below and our team will get back to you within 24-48 hours.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-name">Full Name</Label>
                <Input
                  id="contact-name"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-contact-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-email">Email Address</Label>
                <Input
                  id="contact-email"
                  type="email"
                  placeholder="john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-contact-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-message">Message</Label>
                <Textarea
                  id="contact-message"
                  placeholder="How can we help you?"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  data-testid="input-contact-message"
                />
              </div>
              <Button
                className="w-full"
                onClick={sendMessage}
                disabled={createTicket.isPending}
                data-testid="button-send-message"
              >
                {createTicket.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Send Message
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                By submitting this form, you agree to our{" "}
                <Link href="/legal/terms" className="underline hover:text-foreground">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="/legal/privacy" className="underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          {/* Contact Information + FAQ */}
          <div className="space-y-6">
            <Card>
              <CardContent className="p-6 space-y-4">
                <h2 className="text-lg font-semibold text-foreground">Contact Information</h2>

                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Mailing Address</p>
                    <p className="text-sm text-muted-foreground">
                      Build. Test. Scale., LLC
                      <br />
                      5900 Balcones Drive, STE 100
                      <br />
                      Austin, TX 78731, US
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Email Support</p>
                    <p className="text-sm text-muted-foreground">
                      <a href={`mailto:${SUPPORT_EMAIL}`} className="underline hover:text-foreground">
                        {SUPPORT_EMAIL}
                      </a>
                      <br />
                      Response time: 24-48 business hours
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MessageCircle className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Live chat support</p>
                    <p className="text-sm text-muted-foreground">
                      The fastest way to reach our team is the support chat in the
                      bottom-right corner of every portal page.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      data-testid="button-open-support-chat"
                      onClick={() => {
                        if (!openSupportChat()) {
                          window.location.href = `mailto:${SUPPORT_EMAIL}`;
                        }
                      }}
                    >
                      Open support chat
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-primary text-primary-foreground">
              <CardContent className="p-6 space-y-3">
                <h2 className="text-lg font-semibold">Need Immediate Answers?</h2>
                <p className="text-sm opacity-90">
                  Check our Frequently Asked Questions for quick answers to common
                  questions about Build, Test, Scale™.
                </p>
                <Button asChild variant="secondary" size="sm" data-testid="link-visit-faq">
                  <a href="https://buildtestscale.com/faq" target="_blank" rel="noopener noreferrer">
                    Visit FAQ
                  </a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Contact Page Terms and Conditions */}
        <div className="space-y-4 max-w-3xl mx-auto">
          <h2 className="text-xl font-bold text-foreground text-center">
            CONTACT PAGE TERMS AND CONDITIONS
          </h2>

          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">I. BUSINESS CONTACT INFORMATION</h3>
            <p className="text-sm text-foreground/90">
              <span className="font-semibold">1.1 Legal Business Identity:</span> Build. Test.
              Scale., LLC is a limited liability company organized under the laws of the State of
              Texas.
            </p>
            <p className="text-sm text-foreground/90">
              <span className="font-semibold">1.2 Physical Address:</span> 5900 Balcones Drive, STE
              100, Austin, TX 78731, US.
            </p>
            <p className="text-sm text-foreground/90">
              <span className="font-semibold">1.3 Contact Methods:</span> Email: {SUPPORT_EMAIL}
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">II. CONTACT FORM SPECIFICATIONS</h3>
            <p className="text-sm text-foreground/90">
              <span className="font-semibold">2.1 Data Collection:</span> We collect Name, Email,
              and Message content to respond to inquiries.
            </p>
            <p className="text-sm text-foreground/90">
              <span className="font-semibold">2.2 Usage:</span> Information is used solely for
              customer service and support. We do not sell your personal contact information.
            </p>
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-bold text-foreground">III. RESPONSE TIME</h3>
            <p className="text-sm text-foreground/90">
              We aim to respond to all inquiries within 24-48 hours during regular business days
              (Monday-Friday, excluding holidays).
            </p>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            © 2026 Build. Test. Scale., LLC. All rights reserved.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
