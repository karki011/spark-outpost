import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const form = readFileSync('src/SignupForm.tsx', 'utf8');
const buttons = [...form.matchAll(/<button\b[\s\S]*?(?:\/>|<\/button>)/g)].map((match) => match[0]);
const toggle = buttons.find((button) => !/type=["{]['"]?submit/.test(button)) ?? '';

test('a separate toggle button exists and does not submit the form', () => {
  assert.ok(toggle, 'no toggle button besides submit');
  assert.match(toggle, /type=["{]['"]?button/);
  assert.match(toggle, /onClick=/);
});

test('the toggle tells assistive technology its state and target', () => {
  assert.match(toggle, /aria-pressed=|aria-checked=|role=["']switch/);
  assert.match(toggle, /aria-controls=["{]['"]?signup-password|aria-label=|>[^<]*(?:Show|Hide)/i);
});

test('the password input switches type from state', () => {
  assert.match(
    form,
    /type=\{[^}]*['"]text['"][^}]*['"]password['"][^}]*\}|type=\{[^}]*['"]password['"][^}]*['"]text['"][^}]*\}/,
  );
});
