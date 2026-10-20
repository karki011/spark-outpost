import { describe, expect, it } from 'vitest';
import { htmlNotesText, looksLikeHtml } from './notes-html.ts';
import { notesText } from './google/map.ts';
import { splitNotes } from './notes-text.ts';

const STANDUP =
  'Setting aside 15 minutes Mon-Thu for our team stand-up.<br><br>Agenda is to quickly have each member run through these topics:<ul><li>What did you do yesterday?<br></li><li>What are your goals for today?<br></li><li>Any blockers?</li></ul>Link to Kanban board: <a href="https://acme.atlassian.net/jira/boards/1" target="_blank"><u>https://acme.atlassian.net/jira/boards/1</u></a>.';

const OUTLOOK = `<html>
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<style>p.MsoNormal { margin: 0 }</style></head>
<body lang="EN-US">
<div class="WordSection1">
<p class="MsoNormal">Hi team,<o:p></o:p></p>
<p class="MsoNormal">Please review the
  <a href="https://contoso.sharepoint.com/sites/plan/doc.docx">Q4 plan</a> before we meet.<o:p></o:p></p>
<!--[if !supportLists]--><p class="MsoListParagraph">Budget&nbsp;&amp; headcount</p>
</div>
</body>
</html>`;

describe('htmlNotesText', () => {
  it('turns a Google description into lines, bullets and a plain https link', () => {
    expect(htmlNotesText(STANDUP)).toBe(
      [
        'Setting aside 15 minutes Mon-Thu for our team stand-up.',
        '',
        'Agenda is to quickly have each member run through these topics:',
        '• What did you do yesterday?',
        '• What are your goals for today?',
        '• Any blockers?',
        'Link to Kanban board: https://acme.atlassian.net/jira/boards/1.',
      ].join('\n'),
    );
  });

  it('reads Outlook HTML without its head, styles, comments or source line breaks', () => {
    expect(htmlNotesText(OUTLOOK)).toBe(
      [
        'Hi team,',
        'Please review the Q4 plan (https://contoso.sharepoint.com/sites/plan/doc.docx) before we meet.',
        'Budget & headcount',
      ].join('\n'),
    );
  });

  it('numbers ordered lists and indents nested ones', () => {
    expect(
      htmlNotesText('<ol><li>Intro<ul><li>Names</li><li>Goals</li></ul></li><li>Demo</li></ol>'),
    ).toBe(['1. Intro', '  • Names', '  • Goals', '2. Demo'].join('\n'));
  });

  it('decodes named and numeric entities once', () => {
    expect(
      htmlNotesText('<p>Tom&#39;s &amp; Ann&#x2019;s&nbsp;&hellip; &amp;lt;b&amp;gt;</p>'),
    ).toBe("Tom's & Ann’s … &lt;b&gt;");
  });

  it('drops scripts, styles, handlers and links that are not https', () => {
    const text = htmlNotesText(
      '<p onclick="steal()">Notes</p><script>alert(1)</script><style>p{color:red}</style>' +
        '<a href="javascript:alert(1)">Click me</a> <a href="http://plain.example.com">Plain</a> ' +
        '<a href="https://user:pw@evil.example.com">Sneaky</a><img src="https://x.example/p.png">',
    );
    expect(text).toBe('Notes\nClick me Plain Sneaky');
    expect(text).not.toMatch(/alert|steal|color|javascript|http:|evil/);
  });

  it('unwraps Google redirect links to the https target', () => {
    expect(
      htmlNotesText(
        '<a href="https://www.google.com/url?q=https://docs.example.com/a&amp;sa=D">Doc</a>',
      ),
    ).toBe('Doc (https://docs.example.com/a)');
  });

  it('reads HTML that arrived entity-encoded', () => {
    expect(htmlNotesText('Hello&lt;br&gt;&lt;ul&gt;&lt;li&gt;one&lt;/li&gt;&lt;/ul&gt;')).toBe(
      'Hello\n• one',
    );
  });

  it('leaves plain notes alone', () => {
    const plain = 'a < b and <https://x.example.com>\n\nMeeting ID: 812 3456 7890';
    expect(looksLikeHtml(plain)).toBe(false);
    expect(htmlNotesText(plain)).toBe(plain);
  });

  it('keeps the conference block splittable after conversion', () => {
    const html =
      'Weekly sync<br><br>Join Zoom Meeting<br><a href="https://acme.zoom.us/j/81234567890?pwd=abc">https://acme.zoom.us/j/81234567890?pwd=abc</a><br><br>Meeting ID: 812 3456 7890<br>Passcode: 482913';
    const split = splitNotes(htmlNotesText(html));
    expect(split.agenda).toBe('Weekly sync');
    expect(split.conference).toContain('Meeting ID: 812 3456 7890');
    expect(split.conference).toContain('https://acme.zoom.us/j/81234567890?pwd=abc');
  });

  it('keeps plain-text lines when a description mixes HTML and text', () => {
    const mixed =
      'Agenda<br>\nJoin Zoom Meeting\nhttps://acme.zoom.us/j/81234567890\n\nMeeting ID: 812 3456 7890';
    const split = splitNotes(htmlNotesText(mixed));
    expect(split.agenda).toBe('Agenda');
    expect(split.conference).toContain('Meeting ID: 812 3456 7890');
  });

  it('drops a doctype and processing instructions', () => {
    expect(
      htmlNotesText('<!DOCTYPE html><?xml version="1.0"?><html><body><p>Hello</p></body></html>'),
    ).toBe('Hello');
  });

  it('keeps tag-shaped text the author typed', () => {
    expect(notesText('<p>Wrap it in &lt;div&gt; tags</p>')).toBe('Wrap it in <div> tags');
  });
});
