import React, { useRef } from "react";

interface ActionMenuProps {
  label: string;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}

export function ActionMenu({ label, align = "right", className, children }: ActionMenuProps): React.ReactElement {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function closeAfterAction(event: React.MouseEvent<HTMLDivElement>): void {
    if ((event.target as Element).closest("button,a")) {
      detailsRef.current?.removeAttribute("open");
    }
  }

  function closeOtherMenus(event: React.SyntheticEvent<HTMLDetailsElement>): void {
    if (!event.currentTarget.open) {
      return;
    }
    document.querySelectorAll<HTMLDetailsElement>("details.action-menu[open]").forEach((menu) => {
      if (menu !== event.currentTarget) {
        menu.removeAttribute("open");
      }
    });
  }

  return (
    <details ref={detailsRef} className={["action-menu", `action-menu-${align}`, className ?? ""].filter(Boolean).join(" ")} onToggle={closeOtherMenus}>
      <summary aria-label={label} title={label}>
        <span className="action-menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="sr-only">{label}</span>
      </summary>
      <div className="action-menu-content" onClick={closeAfterAction}>
        {children}
      </div>
    </details>
  );
}
