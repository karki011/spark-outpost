import { describe, expect, it } from 'vitest';
import { scoutFaceCenter, scoutLookTransform } from './scout-look.ts';

const face = { x: 100, y: 100 };

describe('scoutLookTransform', () => {
  it('looks straight ahead when the pointer is on the face', () => {
    expect(scoutLookTransform(face, face)).toBe('translate(0px,0px)');
  });

  it('reaches its limit toward a far pointer and moves less vertically', () => {
    expect(scoutLookTransform(face, { x: 900, y: 100 })).toBe('translate(2.8px,0px)');
    expect(scoutLookTransform(face, { x: 100, y: -900 })).toBe('translate(0px,-2.2px)');
  });

  it('scales with distance inside its reach', () => {
    expect(scoutLookTransform(face, { x: 210, y: 100 })).toBe('translate(1.4px,0px)');
  });

  it('gives the same transform for pointer moves too small to see', () => {
    const near = scoutLookTransform(face, { x: 160, y: 130 });
    expect(scoutLookTransform(face, { x: 161, y: 130.5 })).toBe(near);
  });
});

describe('scoutFaceCenter', () => {
  it('sits below the middle of the mark, where the eyes are', () => {
    expect(scoutFaceCenter({ left: 10, top: 20, width: 50, height: 50 })).toEqual({ x: 35, y: 50 });
  });

  it('has no center before the mark is laid out', () => {
    expect(scoutFaceCenter({ left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });
});
