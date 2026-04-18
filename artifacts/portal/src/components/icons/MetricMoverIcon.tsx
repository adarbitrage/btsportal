import metricMoverLogo from "@assets/metricmover_icon.png";

export function MetricMoverIcon({ className }: { className?: string }) {
  return (
    <img
      src={metricMoverLogo}
      alt="MetricMover"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
