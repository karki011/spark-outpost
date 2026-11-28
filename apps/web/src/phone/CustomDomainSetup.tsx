import { useId, type ReactNode } from 'react';
import type { RemoteAccess } from '@spark-outpost/contracts';
import { CloudflareReachSetup } from '../cloudflare/CloudflareReachSetup.tsx';
import { useQuery } from '@tanstack/react-query';
import { cloudflareApi, cloudflareKeys } from '../cloudflare/cloudflare-api.ts';
import { CUSTOM_SETUP_NOTE, MANUAL_HEADING } from './custom-domain.ts';
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
  const reach = useQuery({ queryKey: cloudflareKeys.reach, queryFn: cloudflareApi.reach });
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
      <CloudflareReachSetup onSaved={onSaved} />
      {reach.data?.available && <h3 className="cf-or">{MANUAL_HEADING}</h3>}
      <CustomDomainForm
        forwardTo={forwardTo}
        replacesTailscale={replacesTailscale}
        onSaved={onSaved}
      />
    </section>
  );
}
