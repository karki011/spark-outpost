import type { Options } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { type Options as SanitizeSchema } from 'rehype-sanitize';

const TEXT_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'div',
  'span',
  'b',
  'i',
  'em',
  'strong',
  'del',
  's',
  'strike',
  'ins',
  'sub',
  'sup',
  'kbd',
  'samp',
  'var',
  'q',
  'code',
  'pre',
  'a',
  'img',
];

const STRUCTURE_TAGS = [
  'ul',
  'ol',
  'li',
  'input',
  'dl',
  'dt',
  'dd',
  'details',
  'summary',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
];

const REMOVED_WITH_CONTENT = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'noscript',
  'noembed',
  'noframes',
  'template',
  'textarea',
  'select',
  'object',
  'embed',
  'title',
  'xmp',
  'svg',
  'math',
];

const safeHtmlSchema: SanitizeSchema = {
  tagNames: [...TEXT_TAGS, ...STRUCTURE_TAGS],
  strip: REMOVED_WITH_CONTENT,
  attributes: {
    a: ['href', 'title'],
    img: ['alt'],
    code: [['className', /^language-[\w+-]+$/]],
    h2: [['className', 'sr-only']],
    ul: [['className', 'contains-task-list']],
    ol: [['className', 'contains-task-list'], 'start'],
    li: [['className', 'task-list-item']],
    input: [['type', 'checkbox'], ['disabled', true], 'checked'],
    details: ['open'],
    th: ['align', 'colSpan', 'rowSpan', 'scope'],
    td: ['align', 'colSpan', 'rowSpan'],
    '*': ['title', 'lang', 'dir'],
  },
  required: { input: { type: 'checkbox', disabled: true } },
  protocols: { href: ['http', 'https', 'mailto'] },
  ancestors: {
    tbody: ['table'],
    thead: ['table'],
    tfoot: ['table'],
    tr: ['table'],
    th: ['table'],
    td: ['table'],
    summary: ['details'],
    input: ['li'],
  },
  clobber: [],
  clobberPrefix: 'user-content-',
};

const URL_SCHEME = /^\s*([a-z][a-z\d+.-]*):/i;

type HastTree = { type: string; properties?: Record<string, unknown>; children?: HastTree[] };

function lowerSchemes(node: HastTree): void {
  const href = node.properties?.href;
  if (typeof href === 'string') {
    node.properties!.href = href.replace(URL_SCHEME, (scheme) => scheme.toLowerCase());
  }
  node.children?.forEach(lowerSchemes);
}

function rehypeLowerSchemes() {
  return lowerSchemes;
}

export const safeHtmlPlugins: Options['rehypePlugins'] = [
  rehypeRaw,
  rehypeLowerSchemes,
  [rehypeSanitize, safeHtmlSchema],
];
