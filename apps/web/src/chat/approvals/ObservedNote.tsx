interface ObservedNoteProps {
  observed: readonly string[] | undefined;
  sendsTo?: string | undefined;
}

export function ObservedNote({ observed, sendsTo }: ObservedNoteProps) {
  if (!observed || observed.length === 0) return null;
  return (
    <p className="appr-observed">
      <b>Read sensitive data this turn:</b> {observed.join(', ')}
      {sendsTo && `. This sends data ${sendsTo}.`}
    </p>
  );
}
