import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';

type CopyText = (text: string) => void;

const CopyContext = createContext<CopyText>(() => undefined);

export function CopyToasts({ children }: { children: ReactNode }) {
  const toaster = useToast();
  const { show } = toaster;
  const copy = useCallback<CopyText>(
    (text) => {
      navigator.clipboard.writeText(text).then(
        () => show({ text: 'Copied' }),
        () => show({ text: 'Copy failed' }),
      );
    },
    [show],
  );
  return (
    <CopyContext.Provider value={copy}>
      {children}
      <div className="cal-toasts">
        <ToastHost toaster={toaster} />
      </div>
    </CopyContext.Provider>
  );
}

export function useCopyText(): CopyText {
  return useContext(CopyContext);
}
