import { useEffect, useState } from 'react';
import { BlobScout, type ScoutMood } from '../../brand/BlobScout.tsx';
import { XIcon } from '../../ui/icons.tsx';
import { useReducedMotion } from '../../ui/motion.ts';
import { SCAN_APPS } from './mcp-labels.ts';

const CAPTION_MS = 420;

export function ScanBlob({ mood, hopping = false }: { mood: ScoutMood; hopping?: boolean }) {
  return (
    <span className={hopping ? 'mcp-blob hopping' : 'mcp-blob'} aria-hidden="true">
      <span className="mcp-blob-hop">
        <BlobScout size={30} mood={mood} />
      </span>
      <span className="mcp-blob-shadow" />
    </span>
  );
}

export function McpScanning() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setIndex((current) => current + 1), CAPTION_MS);
    return () => clearInterval(timer);
  }, [reduced]);

  return (
    <div className="mcp-scan scanning" role="status">
      <div className="mcp-scan-row">
        <ScanBlob mood="working" hopping />
        <p>
          <span className="sr-only">Scanning other apps for MCP servers…</span>
          <span aria-hidden="true">
            {reduced ? 'Checking your apps…' : `Checking ${SCAN_APPS[index % SCAN_APPS.length]}…`}
          </span>
        </p>
      </div>
    </div>
  );
}

export function McpScanFailed({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mcp-scan failed">
      <div className="mcp-scan-row">
        <ScanBlob mood="sad" />
        <p className="mcp-error" role="alert">
          The scan didn’t finish: {message}
        </p>
        <button
          type="button"
          className="mcp-icon-btn"
          aria-label="Dismiss scan result"
          onClick={onDismiss}
        >
          <XIcon />
        </button>
      </div>
    </div>
  );
}
