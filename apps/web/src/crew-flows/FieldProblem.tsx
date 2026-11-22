import { WarnIcon } from '../ui/icons.tsx';

export function FieldProblem({ id, text }: { id: string; text: string | null }) {
  return (
    <p id={id} className="wf-field-problem" role="status">
      {text !== null && (
        <>
          <WarnIcon />
          <span>{text}</span>
        </>
      )}
    </p>
  );
}
