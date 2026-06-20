import React from "react";
import type { ButtonVariant } from "./Button";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  "aria-label": string;
  variant?: Extract<ButtonVariant, "ghost" | "secondary" | "danger">;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ variant = "ghost", className, ...props }, ref): React.ReactElement {
  return <button ref={ref} {...props} className={["ui-icon-button", `ui-icon-button-${variant}`, className ?? ""].filter(Boolean).join(" ")} />;
});
