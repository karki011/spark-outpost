import { useId, useState } from 'react';
import { DocLink } from '../ui/DocLink.tsx';
import { ChevronIcon } from '../ui/icons.tsx';
import { SlackConnectForm } from './SlackConnectForm.tsx';
import { OWN_APP_SUMMARY, SIGN_IN_SUMMARY, SlackSignInPanel } from './SlackSignIn.tsx';

export function SlackConnectMethods({ signInAvailable }: { signInAvailable: boolean }) {
  const id = useId();
  const [ownApp, setOwnApp] = useState(false);
  if (!signInAvailable) return <SlackConnectForm />;
  return (
    <div className="sl-methods">
      <section className="sl-method" aria-labelledby={`${id}-sign-in`}>
        <h4 id={`${id}-sign-in`}>
          Sign in with Slack <DocLink topic="Connect Slack" doc={{ page: 'connect-slack' }} />
        </h4>
        <p className="tk-field-help">{SIGN_IN_SUMMARY}</p>
        <SlackSignInPanel />
      </section>
      <section className="sl-method" aria-labelledby={`${id}-own-app`}>
        <h4 id={`${id}-own-app`}>
          <button
            type="button"
            className="sl-disclose"
            aria-expanded={ownApp}
            aria-controls={`${id}-own-app-body`}
            onClick={() => setOwnApp(!ownApp)}
          >
            <ChevronIcon />
            Use your own Slack app
            <small>Advanced</small>
          </button>
        </h4>
        <p className="tk-field-help">{OWN_APP_SUMMARY}</p>
        <div id={`${id}-own-app-body`} hidden={!ownApp}>
          {ownApp && <SlackConnectForm />}
        </div>
      </section>
    </div>
  );
}
