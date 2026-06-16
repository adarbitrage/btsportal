import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Coach/admin-only form for manually attaching the recording / summary /
// transcript links to a pack booking when auto-matching missed. Never rendered
// on any member-facing surface.

export interface RecordingLinkValues {
  recordingUrl: string;
  summaryUrl: string;
  transcriptUrl: string;
}

export const EMPTY_RECORDING_LINKS: RecordingLinkValues = {
  recordingUrl: "",
  summaryUrl: "",
  transcriptUrl: "",
};

const FIELDS: { key: keyof RecordingLinkValues; label: string; placeholder: string }[] = [
  {
    key: "recordingUrl",
    label: "Recording URL",
    placeholder: "https://drive.google.com/file/…",
  },
  {
    key: "summaryUrl",
    label: "Notes / summary URL",
    placeholder: "https://docs.google.com/document/…",
  },
  {
    key: "transcriptUrl",
    label: "Transcript URL",
    placeholder: "https://docs.google.com/document/…",
  },
];

export function RecordingLinksEditor({
  values,
  onChange,
}: {
  values: RecordingLinkValues;
  onChange: (values: RecordingLinkValues) => void;
}) {
  return (
    <div className="space-y-3">
      {FIELDS.map((f) => (
        <div key={f.key}>
          <Label className="text-xs">{f.label}</Label>
          <Input
            type="url"
            value={values[f.key]}
            placeholder={f.placeholder}
            onChange={(e) => onChange({ ...values, [f.key]: e.target.value })}
            data-testid={`input-${f.key}`}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Pasting any link marks this session as manually attached, so the next
        auto-matching pass won't overwrite it. Clear every field to re-enable
        auto-matching.
      </p>
    </div>
  );
}
