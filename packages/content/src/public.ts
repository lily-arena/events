import type { ContentBlock, PublicContent } from '@first-seat/domain';
import type { ContentBody, ContentPage } from './blocks.js';
import { renderBlocks, type TemplateValues } from './template.js';

/** Public DTO 변환. body_json의 internalNotes는 절대 공개 응답에 넣지 않는다. */
export function toPublicContent(
  versionId: string,
  page: ContentPage,
  body: ContentBody,
  values: TemplateValues,
): PublicContent {
  const blocks: ContentBlock[] = renderBlocks(body.blocks, values);
  return { versionId, page, locale: 'ko', blocks };
}

export function blockText(blocks: readonly ContentBlock[], key: string): string {
  return blocks.find((b) => b.key === key)?.text ?? '';
}

export function blockItems(blocks: readonly ContentBlock[], key: string): readonly string[] {
  return blocks.find((b) => b.key === key)?.items ?? [];
}
