import flexyLogo from "@assets/image_1776537099658.png";

export function FlexyIcon({ className }: { className?: string }) {
  return (
    <img
      src={flexyLogo}
      alt="Flexy"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
