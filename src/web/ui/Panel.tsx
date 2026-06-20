import React from "react";

interface PanelProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "compact" | "full";
  className?: string;
  children: React.ReactNode;
}

export function Panel({ title, description, actions, variant = "full", className, children }: PanelProps): React.ReactElement {
  return (
    <section className={["ui-panel", `ui-panel-${variant}`, className ?? ""].filter(Boolean).join(" ")}>
      {title || description || actions ? (
        <div className="ui-panel-header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="ui-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
