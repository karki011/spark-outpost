import './calendar-parts.css';
import { useEffect } from 'react';
import { ToastHost } from '../conversations/Toast.tsx';
import { useToast } from '../conversations/use-toast.ts';
import { notesProblemText, onNotesProblem } from './join-meeting.ts';

export function JoinNotesToasts() {
  const toaster = useToast();
  const { show } = toaster;
  useEffect(() => onNotesProblem((problem) => show({ text: notesProblemText(problem) })), [show]);
  return (
    <div className="cal-toasts">
      <ToastHost toaster={toaster} />
    </div>
  );
}
