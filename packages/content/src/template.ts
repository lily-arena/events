import type { ContentBlock } from '@first-seat/domain';

/**
 * template 변수는 whitelist만. 에디터가 30이나 날짜를 직접 적어 DB와 어긋나게 하지 않는다.
 */

export const TEMPLATE_VARIABLES = [
  'maxMessageLength',
  'voting_period_kst',
  'result_announcement_kst',
  'internal_weight_percent',
  'public_weight_percent',
  'selection_exception_rules',
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Partial<Record<TemplateVariable, string | number>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/gu;

export function renderTemplate(text: string, values: TemplateValues): string {
  return text.replace(PLACEHOLDER, (match, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return match;
    const value = values[name as TemplateVariable];
    // 미정값은 치환하지 않고 placeholder를 남겨 launch-check가 잡도록 한다.
    return value === undefined || value === null ? match : String(value);
  });
}

export function renderBlocks(
  blocks: readonly ContentBlock[],
  values: TemplateValues,
): ContentBlock[] {
  return blocks.map((block) => ({
    key: block.key,
    type: block.type,
    ...(block.text === undefined ? {} : { text: renderTemplate(block.text, values) }),
    ...(block.items === undefined
      ? {}
      : { items: block.items.map((item) => renderTemplate(item, values)) }),
  }));
}

/** 미정 placeholder가 남아 있는지 확인한다. 실제 유입 페이지 게시 차단 조건. */
export function findUnresolvedPlaceholders(blocks: readonly ContentBlock[]): string[] {
  const found: string[] = [];
  for (const block of blocks) {
    for (const text of [block.text ?? '', ...(block.items ?? [])]) {
      for (const match of text.matchAll(PLACEHOLDER)) found.push(`${block.key}:${match[1]}`);
    }
  }
  return found;
}
