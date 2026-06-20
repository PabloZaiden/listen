import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps): React.ReactElement {
  return (
    <button
      {...props}
      className={["ui-button", `ui-button-${variant}`, `ui-button-${size}`, fullWidth ? "ui-button-full" : "", className ?? ""].filter(Boolean).join(" ")}
      disabled={disabled || loading}
    >
      {loading ? "Working..." : children}
    </button>
  );
}
