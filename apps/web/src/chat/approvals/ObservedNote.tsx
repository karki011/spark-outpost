export function ObservedNote({ observed }: { observed: readonly string[] | undefined }) {
  if (!observed || observed.length === 0) return null;
  return (
    <p className="appr-observed">
      <b>Read sensitive data earlier:</b> {observed.join(', ')}
    </p>
  );
}
