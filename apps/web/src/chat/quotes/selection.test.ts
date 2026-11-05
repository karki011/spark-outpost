// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { clampToMessage, messageIdOf, sourcesFor } from './selection.ts';

function thread() {
  document.body.innerHTML = `
    <div class="thread">
      <section data-assistant-message-id="reply-1">
        <div class="msg me" data-message-id="ask-1"><div class="bubble">How do I deploy?</div></div>
        <div class="msg ai">
          <div class="ai-head"><span>Claude</span><span>done</span></div>
          <div class="md"><p>First <b>build</b> it.</p><p>Then ship it.</p></div>
        </div>
      </section>
      <section data-assistant-message-id="reply-2">
        <div class="msg ai"><div class="md"><p>Second reply.</p></div></div>
      </section>
    </div>
    <div class="composer"><p id="draft">typed text</p></div>`;
  const root = document.querySelector('.thread')!;
  const text = (selector: string) => document.querySelector(selector)!.firstChild!;
  return { root, text };
}

function select(anchor: Node, anchorOffset: number, focus: Node, focusOffset: number) {
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
  return selection;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('clampToMessage', () => {
  it('keeps a selection inside one message as it is', () => {
    const { root, text } = thread();
    const first = text('.md p');
    const result = clampToMessage(select(first, 0, first, 5), root);
    expect(result?.range.toString()).toBe('First');
    expect(result?.source).toBe(document.querySelector('section .md'));
  });

  it('clamps a selection across two messages to the message it started in', () => {
    const { root, text } = thread();
    const result = clampToMessage(
      select(text('section .md p:last-child'), 5, text('section:last-child .md p'), 6),
      root,
    );
    expect(result?.range.toString()).toBe('ship it.');
    expect(result?.source).toBe(document.querySelector('section .md'));
  });

  it('clamps a backwards selection to the message it started in', () => {
    const { root, text } = thread();
    const result = clampToMessage(
      select(text('section:last-child .md p'), 6, text('section .md p:last-child'), 5),
      root,
    );
    expect(result?.range.toString()).toBe('Second');
    expect(result?.source).toBe(document.querySelector('section:last-child .md'));
  });

  it('uses the message when the selection starts in its header', () => {
    const { root, text } = thread();
    const result = clampToMessage(
      select(text('.ai-head span'), 0, text('section .md p:last-child'), 4),
      root,
    );
    expect(result?.range.toString()).toBe('First build it.Then');
  });

  it('includes user messages', () => {
    const { root, text } = thread();
    const bubble = text('.bubble');
    expect(clampToMessage(select(bubble, 0, bubble, 6), root)?.range.toString()).toBe('How do');
  });

  it('ignores selections outside the thread, such as in the composer', () => {
    const { root, text } = thread();
    const draft = text('#draft');
    expect(clampToMessage(select(draft, 0, draft, 5), root)).toBeNull();
  });

  it('ignores collapsed and header-only selections', () => {
    const { root, text } = thread();
    const first = text('.md p');
    expect(clampToMessage(select(first, 2, first, 2), root)).toBeNull();
    const head = text('.ai-head span');
    expect(clampToMessage(select(head, 0, head, 6), root)).toBeNull();
  });
});

describe('message ids', () => {
  it('finds the message a selection source belongs to', () => {
    const { root } = thread();
    expect(messageIdOf(document.querySelector('.bubble')!)).toBe('ask-1');
    expect(messageIdOf(document.querySelector('section .md')!)).toBe('reply-1');
    expect(sourcesFor(root, 'reply-2')).toEqual([document.querySelector('section:last-child .md')]);
    expect(sourcesFor(root, 'ask-1')).toEqual([document.querySelector('.bubble')]);
  });
});
