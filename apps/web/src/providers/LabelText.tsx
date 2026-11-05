import { Fragment } from 'react';
import { parseLabelSegments } from './verify-log.ts';

export function LabelText({ label }: { label: string }) {
  return (
    <>
      {parseLabelSegments(label).map((segment, index) => (
        <Fragment key={index}>{segment.code ? <code>{segment.text}</code> : segment.text}</Fragment>
      ))}
    </>
  );
}
