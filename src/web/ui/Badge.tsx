import React from "react";

export type BadgeVariant = "default" | "unread" | "read" | "active" | "disabled" | "warning" | "danger" | "success" | "info";

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export function Badge({ variant = "default", children }: BadgeProps): React.ReactElement {
  return <span className={`ui-badge ui-badge-${variant}`}>{children}</span>;
}
