export function scoutLabel(asking: number, setAside: number): string {
  const parts = [
    asking > 0 ? `${asking} need you` : null,
    setAside > 0 ? `${setAside} set aside` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `Spark: ${parts.join(', ')}. Open Spark Island` : 'Open Spark Island';
}

export function ScoutMarks({ asking, setAside }: { asking: number; setAside: number }) {
  return (
    <>
      {asking > 0 && (
        <span className="isl-pbadge" aria-hidden="true">
          {asking}
        </span>
      )}
      {setAside > 0 && (
        <span className="isl-aside" aria-hidden="true">
          {setAside}
        </span>
      )}
    </>
  );
}
