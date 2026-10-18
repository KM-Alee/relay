// Prompt-injection posture (docs/05-ai.md §9): untrusted text is DATA inside delimited blocks, with
// angle brackets neutralized so it cannot close a block or open a fake one.
export type Turn = { role: 'customer' | 'ai' | 'human'; text: string };

export const neutralize = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');

export const block = (tag: string, body: string) => `<${tag}>\n${neutralize(body)}\n</${tag}>`;

export function conversationBlock(turns: Turn[], max: number): string {
  const lines = turns.slice(-max).map((t) => `[${t.role}] ${t.text.replace(/\s+/g, ' ').slice(0, 800)}`);
  return block('conversation', lines.join('\n'));
}
