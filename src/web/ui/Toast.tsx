import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastKind = "success" | "error";

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const dismissTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const show = useCallback((kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, kind, message }]);
    const timer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      dismissTimers.current = dismissTimers.current.filter((dismissTimer) => dismissTimer !== timer);
    }, 4_000);
    dismissTimers.current.push(timer);
  }, []);

  useEffect(() => () => {
    for (const timer of dismissTimers.current) {
      clearTimeout(timer);
    }
    dismissTimers.current = [];
  }, []);

  const value = useMemo<ToastContextValue>(() => ({
    success: (message: string) => show("success", message),
    error: (message: string) => show("error", message),
  }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div className={`ui-toast ui-toast-${toast.kind}`} key={toast.id}>{toast.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return value;
}
