import noEscapeLogo from "@assets/image_1776537497466.png";

export function NoEscapeIcon({ className }: { className?: string }) {
  return (
    <img
      src={noEscapeLogo}
      alt="NoEscape"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
