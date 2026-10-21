function countParts(asking: number, setAside: number, working = 0): string[] {
  return [
    asking > 0 ? `${asking} need you` : null,
    setAside > 0 ? `${setAside} set aside` : null,
    working > 0 ? `${working} working` : null,
  ].filter((part) => part !== null);
}

export function scoutLabel(asking: number, setAside: number): string {
  const parts = countParts(asking, setAside);
  return parts.length > 0 ? `Spark: ${parts.join(', ')}. Open Spark Island` : 'Open Spark Island';
}

export function islandStatus(asking: number, setAside: number, working: number): string {
  const parts = countParts(asking, setAside, working);
  return parts.length > 0 ? parts.join(', ') : 'all quiet';
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
