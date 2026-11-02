import { useEffect, useRef } from 'react';
import { LoadingBlob } from '../ui/loading/LoadingBlob.tsx';

interface OlderChatsMoreProps {
  loading: boolean;
  failed: boolean;
  onMore: () => void;
}

export function OlderChatsMore({ loading, failed, onMore }: OlderChatsMoreProps) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = button.current;
    if (!element || loading || failed || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [loading, failed, onMore]);
  if (loading) return <LoadingBlob size="sm" line="Finding older chats…" />;
  return (
    <>
      {failed && (
        <p className="older-chats-failed" role="alert">
          Couldn’t load older chats.
        </p>
      )}
      <button ref={button} type="button" className="older-chats" onClick={onMore}>
        {failed ? 'Try again' : 'Show older chats'}
      </button>
    </>
  );
}
