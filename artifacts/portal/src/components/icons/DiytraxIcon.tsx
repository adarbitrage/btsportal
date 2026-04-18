import diytraxLogo from "@assets/diytrax_icon_dark.png";

export function DiytraxIcon({ className }: { className?: string }) {
  return (
    <img
      src={diytraxLogo}
      alt="Diytrax"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
