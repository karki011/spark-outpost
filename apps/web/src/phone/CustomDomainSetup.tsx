import { useId, type ReactNode } from 'react';
import type { RemoteAccess } from '@spark-outpost/contracts';
import { CUSTOM_SETUP_NOTE } from './custom-domain.ts';
import { CustomDomainForm } from './CustomDomainForm.tsx';

interface CustomDomainSetupProps {
  choice: ReactNode;
  forwardTo: string | null;
  replacesTailscale: boolean;
  onSaved: (access: RemoteAccess) => void;
}

export function CustomDomainSetup({
  choice,
  forwardTo,
  replacesTailscale,
  onSaved,
}: CustomDomainSetupProps) {
  const titleId = useId();
  return (
    <section className="ph-status-block" aria-labelledby={titleId}>
      <div className="ph-status">
        <div className="ph-status-text">
          <h2 id={titleId} className="ph-headline" data-status="off">
            <i className="ph-dot" aria-hidden="true" />
            Set up a custom domain
          </h2>
          <p className="ph-step">{CUSTOM_SETUP_NOTE}</p>
        </div>
      </div>
      {choice}
      <CustomDomainForm
        forwardTo={forwardTo}
        replacesTailscale={replacesTailscale}
        onSaved={onSaved}
      />
    </section>
  );
}
