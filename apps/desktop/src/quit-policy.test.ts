import { expect, it } from 'vitest';
import { createQuitPolicy } from './quit-policy.ts';

it('stops Terminal sessions on a plain quit', () => {
  expect(createQuitPolicy().keepsTerminals()).toBe(false);
});

it('keeps Terminal sessions when the app quits to install an update and reopen', () => {
  const policy = createQuitPolicy();
  policy.installing(true);
  expect(policy.keepsTerminals()).toBe(false);
  policy.quittingForUpdate();
  expect(policy.keepsTerminals()).toBe(true);
});

it('stops Terminal sessions when the user quits and the update installs without reopening', () => {
  const policy = createQuitPolicy();
  policy.installing(false);
  policy.quittingForUpdate();
  expect(policy.keepsTerminals()).toBe(false);
});

it('stops Terminal sessions when an install that stalled is followed by a plain quit', () => {
  const policy = createQuitPolicy();
  policy.installing(true);
  expect(policy.keepsTerminals()).toBe(false);
});

it('stops Terminal sessions when a stalled install is taken over by a quit without reopening', () => {
  const policy = createQuitPolicy();
  policy.installing(true);
  policy.installing(false);
  policy.quittingForUpdate();
  expect(policy.keepsTerminals()).toBe(false);
});

it('keeps Terminal sessions across a relaunch the app asked for', () => {
  const policy = createQuitPolicy();
  policy.relaunching();
  expect(policy.keepsTerminals()).toBe(true);
});
