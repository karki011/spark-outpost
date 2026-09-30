import { describe, expect, it } from 'vitest';
import { applySparkEdits, editableFields, type SparkAction } from './spark-actions.ts';

const comment: SparkAction = {
  action: 'comment_ticket',
  ticket: { source: 'linear', key: 'ENG-1', title: 'A', url: null },
  body: 'Draft',
};

describe('applySparkEdits', () => {
  it('applies edits to editable fields and ignores the rest', () => {
    expect(applySparkEdits(comment, { body: 'Final', title: 'ignored' })).toEqual({
      ...comment,
      body: 'Final',
    });
    expect(applySparkEdits(comment, null)).toBe(comment);
  });

  it('keeps assignments free of edits and rejects invalid values', () => {
    expect(editableFields('assign_ticket')).toEqual([]);
    expect(() => applySparkEdits(comment, { body: '   ' })).toThrow();
  });
});
