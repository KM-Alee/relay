// Proves the Relay UI lint rules (tools/eslint-plugin-relay) catch what they claim to catch.
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
// @ts-expect-error local untyped ESM plugin
import relay from '../../tools/eslint-plugin-relay/index.mjs';

const linter = new Linter();
function lint(code: string, rule: string): string[] {
  const msgs = linter.verify(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { relay },
        rules: { [`relay/${rule}`]: 'error' },
      },
    ],
    'file.tsx',
  );
  return msgs.map((m) => m.message);
}

describe('relay/no-literal-jsx-strings', () => {
  const rule = 'no-literal-jsx-strings';
  it('[F7.1] flags a hard-coded JSX text node', () => {
    expect(lint('const A = () => <p>Hello world</p>;', rule)).toHaveLength(1);
  });
  it('[F7.1] flags literal strings in expression containers and text attributes', () => {
    expect(lint('const A = () => <p>{"Hello"}</p>;', rule)).toHaveLength(1);
    expect(lint('const A = () => <input placeholder="Search" aria-label="Search" />;', rule)).toHaveLength(2);
    expect(lint('const A = () => <img alt="Logo" src={x} />;', rule)).toHaveLength(1);
  });
  it('[F7.1] allows translated text, symbols, empty alt and non-text attributes', () => {
    expect(lint('const A = () => <p>{t("hello")}</p>;', rule)).toEqual([]);
    expect(lint('const A = () => <span>·</span>;', rule)).toEqual([]);
    expect(lint('const A = () => <img alt="" className="x" />;', rule)).toEqual([]);
    expect(lint('const A = () => <b aria-label={t("x")} data-testid="kpi" />;', rule)).toEqual([]);
  });
});

describe('relay/no-physical-direction', () => {
  const rule = 'no-physical-direction';
  it('[F7.2] flags physical left/right Tailwind classes', () => {
    for (const cls of [
      'ml-4',
      'mr-2',
      'pl-3',
      'pr-3',
      'left-0',
      'right-4',
      '-left-2',
      'text-left',
      'text-right',
      'border-l',
      'border-r-2',
      'rounded-l-lg',
      'rounded-tr-xl',
      'md:hover:ml-2',
    ])
      expect(lint(`const a = "flex ${cls} gap-2";`, rule), cls).toHaveLength(1);
  });
  it('[F7.2] allows logical classes', () => {
    expect(
      lint(
        'const a = "ms-4 me-2 ps-3 pe-3 start-0 end-4 text-start text-end border-s border-e rounded-s-lg";',
        rule,
      ),
    ).toEqual([]);
  });
});

describe('relay/no-raw-colors', () => {
  const rule = 'no-raw-colors';
  it('[Q17] flags hex/rgb literals, palette classes and arbitrary colours', () => {
    for (const v of [
      'const a = "#F36B21";',
      'const a = "rgb(1,2,3)";',
      'const a = "bg-orange-500";',
      'const a = "hover:text-slate-900/80";',
      'const a = "bg-white";',
      'const a = "bg-[#fff]";',
      'const a = `border-red-200 p-2`;',
    ])
      expect(lint(v, rule), v).not.toHaveLength(0);
  });
  it('[Q17] allows token classes and var() references', () => {
    expect(
      lint(
        'const a = "bg-brand-strong text-on-brand-strong border-line bg-danger-surface fill-brand";',
        rule,
      ),
    ).toEqual([]);
    expect(lint('const a = { color: "var(--brand-text)" };', rule)).toEqual([]);
    expect(lint('const a = "#section";', rule)).toEqual([]);
  });
});
