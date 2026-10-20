import { describe, expect, it } from 'vitest';
import { guardCopyInPage } from './copy-guard-page.ts';

function fakePage() {
  const ran: string[] = [];
  class Document {
    execCommand(command: string): boolean {
      ran.push(command);
      return true;
    }
  }
  return { scope: { Document }, document: new Document(), ran };
}

describe('the page copy guard', () => {
  it('refuses copy and cut in any case unless Spark allows the write', () => {
    const page = fakePage();
    let allowed = false;
    guardCopyInPage(() => allowed, page.scope);
    expect(page.document.execCommand('copy')).toBe(false);
    expect(page.document.execCommand('Cut')).toBe(false);
    expect(page.ran).toEqual([]);
    allowed = true;
    expect(page.document.execCommand('COPY')).toBe(true);
    expect(page.ran).toEqual(['COPY']);
  });

  it('passes every other command through without asking', () => {
    const page = fakePage();
    let asked = 0;
    guardCopyInPage(() => {
      asked += 1;
      return false;
    }, page.scope);
    expect(page.document.execCommand('bold')).toBe(true);
    expect(page.document.execCommand('paste')).toBe(true);
    expect(page.ran).toEqual(['bold', 'paste']);
    expect(asked).toBe(0);
  });

  it('cannot be replaced by the page', () => {
    const page = fakePage();
    guardCopyInPage(() => false, page.scope);
    expect(() => {
      Object.defineProperty(page.scope.Document.prototype, 'execCommand', { value: () => true });
    }).toThrow();
    expect(page.document.execCommand('copy')).toBe(false);
  });

  it('does nothing on a page without execCommand', () => {
    expect(() => guardCopyInPage(() => false, {})).not.toThrow();
  });
});
