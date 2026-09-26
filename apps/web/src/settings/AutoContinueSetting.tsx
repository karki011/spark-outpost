import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AUTO_CONTINUE_CHOICES } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { Segmented } from '../ui/Segmented.tsx';

const OFF = 'off';

const idOf = (seconds: number | null) => (seconds === null ? OFF : String(seconds));

export function AutoContinueSetting({ seconds }: { seconds: number | null }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (value: number | null) => setupApi.updateProfile({ autoContinueSeconds: value }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  const options = AUTO_CONTINUE_CHOICES.map((choice) => ({
    id: idOf(choice),
    label: choice === null ? 'Off' : `${choice}s`,
  }));
  const current = save.isPending ? save.variables : seconds;
  return (
    <div className="field">
      <span>Auto-continue Jev’s questions after</span>
      <Segmented
        ariaLabel="Auto-continue Jev’s questions after"
        options={options}
        value={idOf(current)}
        onChange={(id) => save.mutate(id === OFF ? null : Number(id))}
      />
      <p className="set-hint" aria-live="polite">
        {save.isError
          ? save.error.message
          : 'When Jev asks and you don’t answer, it takes the safe default. Approvals always wait for you.'}
      </p>
    </div>
  );
}
