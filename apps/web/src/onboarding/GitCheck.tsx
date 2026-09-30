import { useQuery, useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { GIT_INSTALL_COMMAND, type GitStatus } from '@spark-outpost/contracts';
import { setupApi } from '../api/setup.ts';
import { ConnectBlob } from '../tickets/ConnectBlob.tsx';
import { HelpLink } from '../tickets/TicketConnectForm.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { fadeReveal } from '../ui/transitions.tsx';
import { copyButtonText, useCopyFeedback } from '../ui/use-copy-feedback.ts';
import { gitLabel, gitMood, gitStatusQuery } from './git-status.ts';
import '../providers/providers.css';
import '../ship/github-card.css';
import '../tickets/connect.css';
import './git-check.css';

const GIT_DOWNLOAD_URL = 'https://git-scm.com/downloads';

function headLine(status: GitStatus | undefined, checking: boolean): string {
  if (checking || !status) return 'Spark is looking for Git…';
  if (status.installed) return 'Each Do chat gets its own worktree and branch.';
  return 'Do chats need Git to work in their own worktree.';
}

function CopyCommand() {
  const { state, copy } = useCopyFeedback();
  return (
    <div className="git-cmd">
      <code>{GIT_INSTALL_COMMAND}</code>
      <button type="button" className="btn line sm" onClick={() => copy(GIT_INSTALL_COMMAND)}>
        {copyButtonText(state)}
      </button>
    </div>
  );
}

function MissingGit({
  status,
  checking,
  onCheck,
}: {
  status: GitStatus;
  checking: boolean;
  onCheck: () => void;
}) {
  const install = useMutation({ mutationFn: setupApi.installGit });
  return (
    <div className="git-missing">
      <p>
        Spark keeps each Do chat’s work in its own git worktree, so your checkout stays untouched
        until you bring the changes back. You can finish setup now and install Git later.
      </p>
      {!status.canInstall && (
        <p className="gh-note">
          <HelpLink href={GIT_DOWNLOAD_URL}>Download Git</HelpLink> for your computer, then check
          again.
        </p>
      )}
      <div className="git-acts">
        {status.canInstall && (
          <button
            type="button"
            className="btn primary sm"
            onClick={() => install.mutate()}
            disabled={install.isPending || checking}
          >
            Install Xcode Command Line Tools
          </button>
        )}
        <button type="button" className="btn line sm" onClick={onCheck} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p className="gh-note" role="status">
        {install.isSuccess && 'Follow Apple’s installer. When it finishes, choose Check again.'}
      </p>
      {install.isError && (
        <>
          <p className="gh-err" role="alert">
            {install.error.message}
          </p>
          <CopyCommand />
        </>
      )}
    </div>
  );
}

export function GitCheck() {
  const status = useQuery(gitStatusQuery);
  const checking = status.isFetching;
  const data = status.data;
  const found = !checking && data?.installed === true;

  return (
    <section className="pcard git-card" aria-label="Git" aria-busy={checking}>
      <div className="pc-head">
        <span className="git-blob">
          <ConnectBlob mood={gitMood(data, checking)} />
        </span>
        <span className="nm">
          <b>{data && !checking ? gitLabel(data) : 'Git'}</b>
          <small>{headLine(data, checking)}</small>
        </span>
        {checking && <span className="cx-sk" aria-hidden="true" />}
        {found && (
          <span className="pill-ok">
            <CheckIcon />
            Found
          </span>
        )}
      </div>
      {status.isError && !checking && (
        <div className="pc-body">
          <p className="gh-err" role="alert">
            {status.error.message}
          </p>
        </div>
      )}
      <AnimatePresence initial={false}>
        {data && !data.installed && (
          <motion.div key="missing" className="pc-collapse" {...fadeReveal}>
            <div className="pc-body">
              <MissingGit status={data} checking={checking} onCheck={() => void status.refetch()} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
