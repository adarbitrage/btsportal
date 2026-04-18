import gifsterLogo from "@assets/gifster_icon.png";

export function GifsterIcon({ className }: { className?: string }) {
  return (
    <img
      src={gifsterLogo}
      alt="Gifster"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
