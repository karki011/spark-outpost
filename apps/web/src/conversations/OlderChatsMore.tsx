import { useEffect, useRef } from 'react';

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
  return (
    <button ref={button} type="button" className="older-chats" disabled={loading} onClick={onMore}>
      {loading ? 'Loading older chats…' : 'Show older chats'}
    </button>
  );
}
