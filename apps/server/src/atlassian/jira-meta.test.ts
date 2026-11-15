import { describe, expect, it } from 'vitest';
import {
  createMetaFields,
  editMetaFields,
  fieldText,
  fieldValue,
  findField,
  type JiraFieldMeta,
} from './jira-meta.ts';

const meta = (overrides: Partial<JiraFieldMeta>): JiraFieldMeta => ({
  id: 'x',
  name: 'X',
  type: 'string',
  items: null,
  custom: null,
  required: false,
  allowed: null,
  ...overrides,
});
const noUsers = () => Promise.reject(new Error('no lookups'));

describe('Jira field metadata', () => {
  it('reads edit and create metadata into one shape, ignoring odd entries', () => {
    const edit = editMetaFields({
      fields: {
        priority: {
          name: 'Priority',
          required: true,
          schema: { type: 'priority' },
          allowedValues: [{ id: '2', name: 'High' }, { nope: 1 }],
        },
        broken: { name: 'Broken' },
      },
    });
    expect(edit).toEqual([
      meta({
        id: 'priority',
        name: 'Priority',
        type: 'priority',
        required: true,
        allowed: [{ id: '2', label: 'High' }],
      }),
    ]);
    const created = createMetaFields({
      fields: [
        {
          fieldId: 'customfield_1',
          name: 'Size',
          schema: { type: 'option' },
          allowedValues: [{ id: '9', value: 'L' }],
        },
      ],
    });
    expect(created[0]).toMatchObject({ id: 'customfield_1', allowed: [{ id: '9', label: 'L' }] });
  });

  it('finds a field by id or by name, and refuses an ambiguous or unknown name', () => {
    const metas = [
      meta({ id: 'a', name: 'Size' }),
      meta({ id: 'b', name: 'Points' }),
      meta({ id: 'c', name: 'points' }),
    ];
    expect(findField(metas, 'size').id).toBe('a');
    expect(findField(metas, 'c').id).toBe('c');
    expect(() => findField(metas, 'Points')).toThrow(/Several fields.*b, c/);
    expect(() => findField(metas, 'Colour')).toThrow(/spark_jira fields/);
  });
});

describe('Jira field values', () => {
  it('turns names into ids from the allowed values and validates them', async () => {
    const priority = meta({
      id: 'priority',
      name: 'Priority',
      type: 'priority',
      allowed: [{ id: '2', label: 'High' }],
    });
    expect(await fieldValue(priority, 'high', noUsers)).toEqual({ id: '2' });
    await expect(fieldValue(priority, 'Urgent', noUsers)).rejects.toThrow(/choose from High/);
    const components = meta({
      id: 'components',
      name: 'Components',
      type: 'array',
      items: 'component',
      allowed: [{ id: '1', label: 'Frontend' }],
    });
    expect(await fieldValue(components, ['Frontend'], noUsers)).toEqual([{ id: '1' }]);
    expect(await fieldValue(components, 'Frontend', noUsers)).toEqual([{ id: '1' }]);
  });

  it('checks numbers and dates, writes rich text as a document and clears optional fields', async () => {
    const points = meta({ type: 'number', name: 'Points' });
    expect(await fieldValue(points, '5', noUsers)).toBe(5);
    await expect(fieldValue(points, 'many', noUsers)).rejects.toThrow(/pass a number/);
    await expect(fieldValue(meta({ type: 'date' }), '12/01/2026', noUsers)).rejects.toThrow(
      /2026-12-31/,
    );
    expect(await fieldValue(meta({ id: 'description' }), 'Hi', noUsers)).toMatchObject({
      type: 'doc',
    });
    expect(await fieldValue(meta({ type: 'date' }), null, noUsers)).toBeNull();
    await expect(fieldValue(meta({ required: true }), null, noUsers)).rejects.toThrow(/required/);
  });

  it('resolves people through the lookup and keeps unknown types as given', async () => {
    const lookup = async (wanted: string) => ({
      accountId: `id-${wanted}`,
      name: wanted,
      active: true,
    });
    expect(await fieldValue(meta({ type: 'user' }), 'Sam', lookup)).toEqual({
      accountId: 'id-Sam',
    });
    expect(await fieldValue(meta({ type: 'any' }), { odd: true }, noUsers)).toEqual({ odd: true });
  });

  it('shows current values as short text', () => {
    expect(fieldText([{ name: 'A' }, { value: 'B' }])).toBe('A, B');
    expect(fieldText({ displayName: 'Sam' })).toBe('Sam');
    expect(fieldText(null)).toBe('');
    expect(
      fieldText({
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
      }),
    ).toBe('Hi');
  });
});
