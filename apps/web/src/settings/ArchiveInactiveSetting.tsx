import type { ArchiveInactiveDays } from '@spark-outpost/contracts';
import { ProfileChoiceSetting, type ProfileChoice } from './ProfileChoiceSetting.tsx';

export const ARCHIVE_INACTIVE_LABEL = 'Archive inactive chats';

const CHOICES: ProfileChoice<ArchiveInactiveDays>[] = [
  { id: '2', label: 'After 2 days', value: 2 },
  { id: '7', label: 'After 7 days', value: 7 },
  { id: '30', label: 'After 30 days', value: 30 },
  { id: 'never', label: 'Never', value: null },
];

function hint(days: ArchiveInactiveDays): string {
  if (days === null) return 'Chats stay in Active until you archive them.';
  return `A chat with no message, turn or answered card for ${days} days moves to History. Pinned, working and waiting chats stay.`;
}

export function ArchiveInactiveSetting({ days }: { days: ArchiveInactiveDays }) {
  return (
    <ProfileChoiceSetting
      saved={days}
      choices={CHOICES}
      label={ARCHIVE_INACTIVE_LABEL}
      hint={hint}
      doc={{ page: 'statuses-and-limits', heading: 'chat-list' }}
      toUpdate={(value) => ({ archiveInactiveDays: value })}
    />
  );
}
