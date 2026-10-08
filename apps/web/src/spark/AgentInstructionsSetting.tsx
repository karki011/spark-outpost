import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Profile } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';

export function AgentInstructionsSetting({ profile }: { profile: Profile }) {
  const id = useId();
  const fileId = useId();
  const { remote } = useRemoteClient();
  const client = useQueryClient();
  const [text, setText] = useState(profile.agentInstructions ?? '');
  const [file, setFile] = useState(profile.agentInstructionsFile ?? '');
  const [fileOpen, setFileOpen] = useState(Boolean(profile.agentInstructionsFile));
  const save = useMutation({
    mutationFn: () =>
      setupApi.updateProfile({
        agentInstructions: text,
        ...(!remote ? { agentInstructionsFile: file } : {}),
      }),
    onSuccess: (state) => client.setQueryData(setupKey, state),
  });
  const changed =
    text !== (profile.agentInstructions ?? '') || file !== (profile.agentInstructionsFile ?? '');
  return (
    <form
      className="spark-instructions"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending && changed) save.mutate();
      }}
    >
      <fieldset disabled={save.isPending} aria-label="Agent instructions">
        <label htmlFor={id}>Custom instructions</label>
        <textarea
          id={id}
          className="inp"
          rows={3}
          maxLength={8000}
          value={text}
          placeholder="How would you like your agent to work?"
          onChange={(event) => {
            save.reset();
            setText(event.target.value);
          }}
        />
        {!remote && (
          <details open={fileOpen} onToggle={(event) => setFileOpen(event.currentTarget.open)}>
            <summary>Use an instruction file</summary>
            <label htmlFor={fileId}>Instructions file path</label>
            <input
              id={fileId}
              className="inp"
              value={file}
              maxLength={4096}
              placeholder="~/Documents/agent-instructions.md"
              onChange={(event) => {
                save.reset();
                setFile(event.target.value);
              }}
            />
          </details>
        )}
        <div className="spark-instructions-save">
          <button type="submit" className="btn line sm" disabled={!changed}>
            {save.isPending ? 'Saving…' : 'Save instructions'}
          </button>
          <small role={save.isError ? 'alert' : 'status'}>
            {save.isError
              ? save.error.message
              : 'Sent to your agent when a session starts. Files are read from this Mac.'}
          </small>
        </div>
      </fieldset>
    </form>
  );
}
