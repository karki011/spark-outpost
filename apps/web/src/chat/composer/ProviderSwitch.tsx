import type { KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import type { ProviderId, ProviderSetup } from '@spark-outpost/contracts';
import { ProviderBlob } from '../../brand/ProviderBlob.tsx';
import { reveal } from '../../ui/transitions.tsx';

interface ProviderSwitchProps {
  providers: ProviderSetup[];
  active: ProviderId;
  onSelect: (id: ProviderId) => void;
}

export function ProviderSwitch({ providers, active, onSelect }: ProviderSwitchProps) {
  const index = Math.max(
    0,
    providers.findIndex((provider) => provider.id === active),
  );
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = providers[(index + step + providers.length) % providers.length];
    if (!next) return;
    onSelect(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-provider="${next.id}"]`)?.focus();
  };
  return (
    <div className="pswitch" role="tablist" aria-label="AI provider" onKeyDown={onKeyDown}>
      {providers.map((provider) => {
        const selected = provider.id === active;
        return (
          <button
            key={provider.id}
            type="button"
            role="tab"
            data-provider={provider.id}
            data-tip={selected ? `${provider.name} · in use` : `Switch to ${provider.name}`}
            aria-label={provider.name}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(provider.id)}
          >
            {selected && (
              <motion.span layoutId="provider-ring" className="pswitch-ring" transition={reveal} />
            )}
            <motion.span
              className="pswitch-blob"
              animate={{ scale: selected ? 1.12 : 1 }}
              transition={reveal}
              whileHover={{ scale: selected ? 1.16 : 1.08 }}
              whileTap={{ scale: 0.92 }}
            >
              <ProviderBlob
                providerId={provider.id}
                size={24}
                expression={selected ? 'happy' : 'idle'}
                animate="hover"
              />
            </motion.span>
          </button>
        );
      })}
    </div>
  );
}
