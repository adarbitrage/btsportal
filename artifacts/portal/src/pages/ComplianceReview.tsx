import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Send, CheckCircle2, Upload } from "lucide-react";
import { useState, useRef } from "react";

const creativeTypes = ["Banner", "Landing Page"];
const trafficSources = ["Grasshopper", "Crane", "Caterpillar", "Meta", "Other"];
const shareOptions = ["Yes, I have shared access", "No, I have not shared access"];

export default function ComplianceReview() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [offerName, setOfferName] = useState("");
  const [selectedCreatives, setSelectedCreatives] = useState<string[]>([]);
  const [selectedTraffic, setSelectedTraffic] = useState<string[]>([]);
  const [driveLink, setDriveLink] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleItem = (list: string[], setList: (v: string[]) => void, item: string) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  const inputClass =
    "w-full px-3 py-2 border border-border rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/40";

  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm border transition-colors ${
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-background border-border text-muted-foreground hover:border-foreground/40"
    }`;

  if (submitted) {
    return (
      <AppLayout>
        <div className="space-y-6 max-w-6xl">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-6 h-6 text-primary" />
              <h1 className="text-3xl font-bold">Compliance Review</h1>
            </div>
            <p className="text-muted-foreground">
              Submit your creative for review before running it on any traffic source.
            </p>
          </div>

          <Card className="border-border/60">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-foreground" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Submission Received</h2>
              <p className="text-muted-foreground">
                Your creative has been submitted for compliance review. We'll review it within 24 hours.
              </p>
              <Button onClick={() => setSubmitted(false)} variant="outline" className="mt-4">
                Submit Another Creative
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold">Compliance Review</h1>
          </div>
          <p className="text-muted-foreground">
            Submit your creative below and we'll review it within 24 hours. Please include
            everything we'll need to evaluate the offer, the creative, and the traffic
            source you plan to run it on.
          </p>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-6 md:p-8">
            <form onSubmit={handleSubmit} className="space-y-5">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">First Name *</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={inputClass}
                    data-testid="input-first-name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className={inputClass}
                    data-testid="input-last-name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  data-testid="input-email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Name Of The Offer You Are Promoting *</label>
                <input
                  type="text"
                  required
                  value={offerName}
                  onChange={(e) => setOfferName(e.target.value)}
                  className={inputClass}
                  data-testid="input-offer-name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Which creative is this for? *</label>
                <div className="flex flex-wrap gap-2">
                  {creativeTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleItem(selectedCreatives, setSelectedCreatives, t)}
                      className={chipClass(selectedCreatives.includes(t))}
                      data-testid={`chip-creative-${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Which traffic source will you be using these creatives for? *</label>
                <div className="flex flex-wrap gap-2">
                  {trafficSources.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleItem(selectedTraffic, setSelectedTraffic, t)}
                      className={chipClass(selectedTraffic.includes(t))}
                      data-testid={`chip-traffic-${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Google Drive Link To Your Creative Folder
                </label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  If you don't have a Google Drive link, you can upload a zip file below.
                </p>
                <input
                  type="url"
                  value={driveLink}
                  onChange={(e) => setDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className={inputClass}
                  data-testid="input-drive-link"
                />
              </div>

              {driveLink && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Have you shared access with the Concierge Team?
                  </label>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    Failure to share proper access will delay completion of this task.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {shareOptions.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setShareStatus(opt)}
                        className={chipClass(shareStatus === opt)}
                        data-testid={`chip-share-${opt}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Upload Your Creative Zip File</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-foreground/40 transition-colors"
                  data-testid="dropzone-files"
                >
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {files.length > 0 ? `${files.length} file(s) selected` : "Drag & drop files or click to browse"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">You can upload up to 100 files</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  className="hidden"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Anything Else You Would Like Us To Know?
                </label>
                <textarea
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Please be as specific and detailed as possible..."
                  className={`${inputClass} resize-none`}
                  data-testid="input-notes"
                />
              </div>

              <Button type="submit" className="gap-2 w-full sm:w-auto" data-testid="button-submit">
                <Send className="w-4 h-4" />
                Submit For Review
              </Button>

            </form>
          </CardContent>
        </Card>

      </div>
    </AppLayout>
  );
}
