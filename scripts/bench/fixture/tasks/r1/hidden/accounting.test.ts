import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCents, parseCents } from '../src/money.ts';

test('reads accounting negatives in parentheses', () => {
  assert.equal(parseCents('($1,234.50)'), -123450);
  assert.equal(parseCents(' (12.00) '), -1200);
  assert.equal(parseCents('($0.10)'), -10);
});

test('keeps ordinary amounts and minus signs working', () => {
  assert.equal(parseCents('-$5.00'), -500);
  assert.equal(parseCents('$-5.25'), -525);
  assert.equal(parseCents('$1,234.50'), 123450);
  assert.equal(parseCents('7'), 700);
});

test('rejects parentheses that do not wrap the whole amount', () => {
  assert.throws(() => parseCents('(5.00'));
  assert.throws(() => parseCents('5.00)'));
  assert.throws(() => parseCents('1(2)3'));
  assert.throws(() => parseCents('(-5.00)'));
  assert.throws(() => parseCents('()'));
  assert.throws(() => parseCents('abc'));
});

test('leaves formatting unchanged', () => {
  assert.equal(formatCents(123456), '$1234.56');
  assert.equal(formatCents(-50), '-$0.50');
});
