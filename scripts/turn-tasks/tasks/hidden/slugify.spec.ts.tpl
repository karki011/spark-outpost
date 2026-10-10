import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as text from '../../src/text.ts';

const slugify = (text as Record<string, unknown>).slugify as (name: string) => string;

test('slugify is exported from src/text.ts', () => {
  assert.equal(typeof slugify, 'function');
});

test('lower-cases and joins words with one dash', () => {
  assert.equal(slugify('Blue Ceramic Mug'), 'blue-ceramic-mug');
  assert.equal(slugify('A--B__c'), 'a-b-c');
});

test('drops dashes at both ends', () => {
  assert.equal(slugify('  Hello, World!  '), 'hello-world');
  assert.equal(slugify('--42 mugs--'), '42-mugs');
});

test('keeps only a to z and 0 to 9', () => {
  assert.equal(slugify('Café №7'), 'caf-7');
});

test('gives an empty string when nothing is left', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('!!! ???'), '');
});
