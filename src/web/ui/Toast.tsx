interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const toast: ToastContextValue = {
  success: () => undefined,
  error: (message) => console.error(message),
};

export function useToast(): ToastContextValue {
  return toast;
}
