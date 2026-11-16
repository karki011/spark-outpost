import { createContext, use } from 'react';
import { SparkleIcon } from '../ui/icons.tsx';

const BUILDER_LABEL = 'Let Spark build one for you';

interface BuilderButtonState {
  open: boolean;
  start(): void;
}

export const BuilderButtonContext = createContext<BuilderButtonState | null>(null);

export function BuilderButton({ primary = false }: { primary?: boolean }) {
  const builder = use(BuilderButtonContext);
  if (!builder) return null;
  return (
    <button
      type="button"
      className={primary ? 'btn primary sm spk-new-spark' : 'btn sm spk-new-spark'}
      disabled={builder.open}
      title={builder.open ? 'The builder chat is open on the right.' : undefined}
      onClick={builder.start}
    >
      <SparkleIcon /> {BUILDER_LABEL}
    </button>
  );
}
