import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWinMilestones, useCreateWin, useUpdateWin, useUploadProofImage, useWin } from "@/hooks/use-wins";
import { useLocation, useSearch } from "wouter";
import { Trophy, Upload, X, ArrowLeft, ArrowRight, Calendar, DollarSign, Loader2 } from "lucide-react";
import type { WinMilestone } from "@/lib/wins-api";

const CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
  revenue: { label: "Revenue", icon: "💰" },
  campaign: { label: "Campaign", icon: "🎯" },
  skill: { label: "Skill", icon: "🎓" },
  lifestyle: { label: "Lifestyle", icon: "🎉" },
  custom: { label: "Custom", icon: "🏅" },
};

export default function WinSubmit() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const editId = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("edit") ? parseInt(params.get("edit")!, 10) : 0;
  }, [searchString]);
  const isEditMode = editId > 0;

  const { data: milestones, isLoading: milestonesLoading } = useWinMilestones();
  const { data: existingWin, isLoading: existingWinLoading } = useWin(editId);
  const createWin = useCreateWin();
  const updateWin = useUpdateWin();
  const uploadProof = useUploadProofImage();

  const [step, setStep] = useState(1);
  const [selectedMilestone, setSelectedMilestone] = useState<WinMilestone | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [winDate, setWinDate] = useState(new Date().toISOString().split("T")[0]);
  const [revenueAmount, setRevenueAmount] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [proofImage1, setProofImage1] = useState<File | null>(null);
  const [proofImage2, setProofImage2] = useState<File | null>(null);
  const [proofPreview1, setProofPreview1] = useState<string | null>(null);
  const [proofPreview2, setProofPreview2] = useState<string | null>(null);
  const [shareToCommunity, setShareToCommunity] = useState(true);
  const [allowTestimonial, setAllowTestimonial] = useState(false);
  const [allowPublicName, setAllowPublicName] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (isEditMode && existingWin && milestones && !prefilled) {
      const milestone = milestones.find((m) => m.id === existingWin.milestone.id);
      if (milestone) setSelectedMilestone(milestone);
      setTitle(existingWin.title);
      setDescription(existingWin.description);
      setWinDate(existingWin.winDate.split("T")[0]);
      setRevenueAmount(existingWin.revenueAmount?.toString() ?? "");
      setMetricLabel(existingWin.metricLabel ?? "");
      setMetricValue(existingWin.metricValue ?? "");
      setShareToCommunity(existingWin.shareToCommunity);
      setAllowTestimonial(existingWin.allowTestimonial);
      setAllowPublicName(existingWin.allowPublicName);
      if (existingWin.proofImageUrl) setProofPreview1(existingWin.proofImageUrl);
      if (existingWin.proofImage2Url) setProofPreview2(existingWin.proofImage2Url);
      setStep(2);
      setPrefilled(true);
    }
  }, [isEditMode, existingWin, milestones, prefilled]);

  const fileInput1Ref = useRef<HTMLInputElement>(null);
  const fileInput2Ref = useRef<HTMLInputElement>(null);

  const groupedMilestones = milestones?.reduce<Record<string, WinMilestone[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {}) ?? {};

  const handleImageSelect = useCallback((file: File, slot: 1 | 2) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (slot === 1) {
        setProofImage1(file);
        setProofPreview1(e.target?.result as string);
      } else {
        setProofImage2(file);
        setProofPreview2(e.target?.result as string);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = async (status: "published" | "draft") => {
    if (!selectedMilestone || !title.trim() || !description.trim()) return;
    setSubmitting(true);

    try {
      let proofImageUrl: string | undefined;
      let proofImage2Url: string | undefined;

      if (proofImage1) {
        const result = await uploadProof.mutateAsync(proofImage1);
        proofImageUrl = result.url;
      }
      if (proofImage2) {
        const result = await uploadProof.mutateAsync(proofImage2);
        proofImage2Url = result.url;
      }

      const payload = {
        milestoneId: selectedMilestone.id,
        title: title.trim(),
        description: description.trim(),
        winDate,
        revenueAmount: revenueAmount ? parseFloat(revenueAmount) : undefined,
        metricLabel: metricLabel.trim() || undefined,
        metricValue: metricValue.trim() || undefined,
        proofImageUrl: proofImageUrl ?? (proofPreview1 && !proofImage1 ? proofPreview1 : undefined),
        proofImage2Url: proofImage2Url ?? (proofPreview2 && !proofImage2 ? proofPreview2 : undefined),
        shareToCommunity,
        allowTestimonial,
        allowPublicName,
        status,
      };

      if (isEditMode) {
        await updateWin.mutateAsync({ winId: editId, data: payload });
      } else {
        await createWin.mutateAsync(payload);
      }

      navigate("/wins/mine");
    } catch {
    } finally {
      setSubmitting(false);
    }
  };

  const canProceedToStep2 = selectedMilestone !== null;
  const canSubmit = title.trim().length > 0 && description.trim().length >= 10;

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/wins")}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </div>

        {isEditMode && existingWinLoading ? (
          <div className="flex items-center gap-3 mb-6">
            <Skeleton className="w-12 h-12 rounded-xl" />
            <div>
              <Skeleton className="h-6 w-40 mb-1" />
              <Skeleton className="h-4 w-60" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Trophy className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{isEditMode ? "Edit Win" : "Log a Win"}</h1>
              <p className="text-muted-foreground text-sm">
                {isEditMode ? "Update your win details" : "Celebrate your achievement with the community"}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-6">
          {[1, 2].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                  step >= s
                    ? "bg-primary text-white"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {s}
              </div>
              <span className={cn("text-sm font-medium", step >= s ? "text-foreground" : "text-muted-foreground")}>
                {s === 1 ? "Select Milestone" : "Details & Proof"}
              </span>
              {s < 2 && <div className="w-8 h-px bg-border mx-1" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">What did you achieve?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {milestonesLoading ? (
                <div className="space-y-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                Object.entries(groupedMilestones).map(([category, categoryMilestones]) => {
                  const cat = CATEGORY_LABELS[category] || { label: category, icon: "🏅" };
                  return (
                    <div key={category}>
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                        <span>{cat.icon}</span>
                        {cat.label}
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {categoryMilestones.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedMilestone(m)}
                            className={cn(
                              "p-3 rounded-lg border text-left transition-all hover:shadow-sm",
                              selectedMilestone?.id === m.id
                                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                : "border-border hover:border-primary/30"
                            )}
                          >
                            <span className="text-xl block mb-1">{m.icon}</span>
                            <p className="text-sm font-medium text-foreground leading-tight">{m.name}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}

              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!canProceedToStep2}
                  className="gap-2"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && selectedMilestone && (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3 bg-primary/5 rounded-lg p-3">
                  <span className="text-2xl">{selectedMilestone.icon}</span>
                  <div>
                    <p className="font-semibold text-foreground">{selectedMilestone.name}</p>
                    <p className="text-sm text-muted-foreground">{selectedMilestone.description}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setStep(1)}
                  >
                    Change
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tell us about your win</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    placeholder="e.g., Hit my first $1K day!"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={200}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Tell your story</Label>
                  <Textarea
                    id="description"
                    placeholder="Share the details of your achievement..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[120px]"
                    maxLength={2000}
                  />
                  <p className="text-xs text-muted-foreground text-right">{description.length}/2000</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="winDate" className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      When did this happen?
                    </Label>
                    <Input
                      id="winDate"
                      type="date"
                      value={winDate}
                      onChange={(e) => setWinDate(e.target.value)}
                    />
                  </div>

                  {(selectedMilestone.category === "revenue" || selectedMilestone.category === "campaign") && (
                    <div className="space-y-2">
                      <Label htmlFor="revenue" className="flex items-center gap-1.5">
                        <DollarSign className="w-3.5 h-3.5" />
                        Revenue amount
                      </Label>
                      <Input
                        id="revenue"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={revenueAmount}
                        onChange={(e) => setRevenueAmount(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="metricLabel">Custom metric label (optional)</Label>
                    <Input
                      id="metricLabel"
                      placeholder="e.g., ROI, CTR"
                      value={metricLabel}
                      onChange={(e) => setMetricLabel(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="metricValue">Custom metric value</Label>
                    <Input
                      id="metricValue"
                      placeholder="e.g., 340%"
                      value={metricValue}
                      onChange={(e) => setMetricValue(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Upload proof</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Dashboard screenshot, earnings report, etc. (up to 2 images)
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <ProofUploadSlot
                    preview={proofPreview1}
                    onSelect={(f) => handleImageSelect(f, 1)}
                    onRemove={() => { setProofImage1(null); setProofPreview1(null); }}
                    inputRef={fileInput1Ref}
                  />
                  <ProofUploadSlot
                    preview={proofPreview2}
                    onSelect={(f) => handleImageSelect(f, 2)}
                    onRemove={() => { setProofImage2(null); setProofPreview2(null); }}
                    inputRef={fileInput2Ref}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Sharing options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="shareToCommunity"
                    checked={shareToCommunity}
                    onCheckedChange={(v) => setShareToCommunity(v === true)}
                  />
                  <Label htmlFor="shareToCommunity" className="text-sm leading-relaxed cursor-pointer">
                    Share this win to the BTS community
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="allowTestimonial"
                    checked={allowTestimonial}
                    onCheckedChange={(v) => setAllowTestimonial(v === true)}
                  />
                  <div>
                    <Label htmlFor="allowTestimonial" className="text-sm leading-relaxed cursor-pointer">
                      I consent to BTS using this win as a testimonial
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      On the website, in marketing materials, or in ads
                    </p>
                  </div>
                </div>
                {allowTestimonial && (
                  <div className="flex items-start gap-3 ml-6">
                    <Checkbox
                      id="allowPublicName"
                      checked={allowPublicName}
                      onCheckedChange={(v) => setAllowPublicName(v === true)}
                    />
                    <Label htmlFor="allowPublicName" className="text-sm leading-relaxed cursor-pointer">
                      You may use my full name (otherwise first name + last initial)
                    </Label>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between pt-2 pb-8">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => handleSubmit("draft")}
                  disabled={submitting || !canSubmit}
                >
                  Save as Draft
                </Button>
                <Button
                  onClick={() => handleSubmit("published")}
                  disabled={submitting || !canSubmit}
                  className="gap-2 shadow-lg shadow-primary/20"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {isEditMode ? "Saving..." : "Publishing..."}
                    </>
                  ) : (
                    <>
                      {isEditMode ? "Save Changes" : "Publish Win"}
                      <Trophy className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function ProofUploadSlot({
  preview,
  onSelect,
  onRemove,
  inputRef,
}: {
  preview: string | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("image/")) {
        onSelect(file);
      }
    },
    [onSelect]
  );

  if (preview) {
    return (
      <div className="relative rounded-lg overflow-hidden border border-border group">
        <img src={preview} alt="Proof" className="w-full h-32 object-cover" />
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 w-6 h-6 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg h-32 flex flex-col items-center justify-center cursor-pointer transition-colors",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-secondary/50"
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Upload className="w-6 h-6 text-muted-foreground mb-1.5" />
      <p className="text-xs text-muted-foreground">Drop image or click</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
        }}
      />
    </div>
  );
}
