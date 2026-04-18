import pixelPressLogo from "@assets/image_1776537314824.png";

export function PixelPressIcon({ className }: { className?: string }) {
  return (
    <img
      src={pixelPressLogo}
      alt="PixelPress"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
