import { BlobScout } from '../brand/BlobScout.tsx';

interface ComingSoonProps {
  title: string;
  text: string;
  onChats: () => void;
}

export function ComingSoon({ title, text, onChats }: ComingSoonProps) {
  return (
    <main className="page soon-page" aria-labelledby="soon-title">
      <div className="soon-in">
        <BlobScout size={64} mood="sleep" />
        <h2 id="soon-title">{title}</h2>
        <p>{text}</p>
        <button type="button" className="btn primary" onClick={onChats}>
          Go to Chats
        </button>
      </div>
    </main>
  );
}
