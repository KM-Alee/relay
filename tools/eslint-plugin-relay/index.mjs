// Local ESLint plugin enforcing Relay's UI rules (AGENTS.md §3.9, docs/07 §5-§6, docs/design/tokens.md §5).
// Written by hand (ESLint 10 flat config; no third-party i18n plugin needed). Owner: Lane D.
//   relay/no-literal-jsx-strings  every user-visible string comes from next-intl (F7.1)
//   relay/no-physical-direction   Tailwind logical properties only, so RTL works (F7.2, Q16)
//   relay/no-raw-colors           tokens only: no hex/rgb literals or Tailwind palette classes (DS, Q17)

const LETTER = /\p{L}/u;
const hasText = (s) => LETTER.test(s);

// ---------------------------------------------------------------- no-literal-jsx-strings
const TEXT_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
]);

const noLiteralJsxStrings = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow hard-coded user-visible strings in JSX; use next-intl keys.' },
    messages: {
      text: 'Hard-coded string in JSX. Use a next-intl key (en + ur): t("…").',
      attr: 'Hard-coded string in the "{{name}}" attribute. Use a next-intl key (en + ur).',
    },
    schema: [],
  },
  create(context) {
    const literalText = (node) => {
      if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
      if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
        return node.quasis.map((q) => q.value.cooked ?? '').join('');
      return null;
    };
    return {
      JSXText(node) {
        if (hasText(node.value)) context.report({ node, messageId: 'text' });
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent.type !== 'JSXElement' && parent.type !== 'JSXFragment') return;
        const text = literalText(node.expression);
        if (text !== null && hasText(text)) context.report({ node, messageId: 'text' });
      },
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : null;
        if (!name || !TEXT_ATTRS.has(name) || !node.value) return;
        const v = node.value;
        const text = v.type === 'JSXExpressionContainer' ? literalText(v.expression) : literalText(v);
        if (text !== null && hasText(text)) context.report({ node, messageId: 'attr', data: { name } });
      },
    };
  },
};

// ---------------------------------------------------------------- class-string helpers
const VARIANTS = String.raw`(?:[^\s:]+:)*!?-?`;
const PHYSICAL = new RegExp(
  `^${VARIANTS}(?:(?:m|p)[lr]-\\S+|(?:left|right)-\\S+|text-(?:left|right)|border-[lr](?:-\\S+)?|` +
    `rounded-(?:l|r|tl|tr|bl|br)(?:-\\S+)?|scroll-(?:m|p)[lr]-\\S+|float-(?:left|right)|clear-(?:left|right))$`,
);
const PALETTE = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');
const COLOR_UTILS =
  'bg|text|border|border-[xystblr]|ring|ring-offset|fill|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret|placeholder';
const RAW_CLASS = [
  new RegExp(`^${VARIANTS}(?:${COLOR_UTILS})-(?:${PALETTE})-\\d{2,3}(?:/\\d+)?$`),
  new RegExp(`^${VARIANTS}(?:${COLOR_UTILS})-(?:white|black)(?:/\\d+)?$`),
  new RegExp(`^${VARIANTS}[a-z-]+-\\[(?:#|rgb|hsl|oklch|oklab|lab|lch|hwb|color-mix)`),
];
const RAW_VALUE = [
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/,
  /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb)\(/i,
];

function stringsOf(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateElement') return [node.value.cooked ?? ''];
  return [];
}
const isModuleSpecifier = (node) =>
  node.parent &&
  (node.parent.type === 'ImportDeclaration' ||
    node.parent.type === 'ExportAllDeclaration' ||
    node.parent.type === 'ExportNamedDeclaration' ||
    node.parent.type === 'ImportExpression');

const noPhysicalDirection = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow physical left/right Tailwind classes; use logical ones (ms-, pe-, start-…).',
    },
    messages: {
      physical:
        '"{{cls}}" is a physical direction class. Use the logical equivalent (ms-/me-/ps-/pe-/start-/end-/text-start/border-s/rounded-s…).',
    },
    schema: [],
  },
  create(context) {
    const check = (node) => {
      if (isModuleSpecifier(node)) return;
      for (const s of stringsOf(node))
        for (const cls of s.split(/\s+/))
          if (cls && PHYSICAL.test(cls)) context.report({ node, messageId: 'physical', data: { cls } });
    };
    return { Literal: check, TemplateElement: check };
  },
};

const noRawColors = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw colour values and Tailwind palette classes; use design tokens.' },
    messages: {
      raw: 'Raw colour "{{value}}". Use a design token (bg-surface, text-fg, bg-brand-strong…). Raw values live only in globals.css.',
    },
    schema: [],
  },
  create(context) {
    const check = (node) => {
      if (isModuleSpecifier(node)) return;
      for (const s of stringsOf(node)) {
        for (const cls of s.split(/\s+/))
          if (cls && RAW_CLASS.some((r) => r.test(cls)))
            context.report({ node, messageId: 'raw', data: { value: cls } });
        for (const r of RAW_VALUE) {
          const m = r.exec(s);
          if (m) context.report({ node, messageId: 'raw', data: { value: m[0] } });
        }
      }
    };
    return { Literal: check, TemplateElement: check };
  },
};

export default {
  meta: { name: 'eslint-plugin-relay' },
  rules: {
    'no-literal-jsx-strings': noLiteralJsxStrings,
    'no-physical-direction': noPhysicalDirection,
    'no-raw-colors': noRawColors,
  },
};
