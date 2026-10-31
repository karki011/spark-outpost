import { useEffect, useRef } from 'react';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';

interface OlderChatsMoreProps {
  loading: boolean;
  onMore: () => void;
}

export function OlderChatsMore({ loading, onMore }: OlderChatsMoreProps) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = button.current;
    if (!element || loading || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, onMore]);
  if (loading) return <LoadingBlob size="sm" line="Finding older chats…" />;
  return (
    <button ref={button} type="button" className="older-chats" onClick={onMore}>
      Show older chats
    </button>
  );
}
