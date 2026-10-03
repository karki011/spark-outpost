import './loading.css';
import { BlobScout } from '../../brand/BlobScout.tsx';

interface LoadingBlobProps {
  line: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const PIXELS = { sm: 22, md: 36, lg: 48 } as const;

export function LoadingBlob({ line, size = 'md', className }: LoadingBlobProps) {
  return (
    <div className={className ? `loadblob ${size} ${className}` : `loadblob ${size}`} role="status">
      <span className="loadblob-scene" aria-hidden="true">
        <BlobScout size={PIXELS[size]} mood="working" />
        <svg className="loadblob-glass" viewBox="0 0 16 16">
          <circle cx="6" cy="6" r="4" />
          <path d="M9 9l4.5 4.5" />
        </svg>
      </span>
      <span className="loadblob-line">{line}</span>
    </div>
  );
}
