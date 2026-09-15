import submissionSeed from './seed/submission.json' with { type: 'json' };
import submittedSeed from './seed/submitted.json' with { type: 'json' };
import votingSeed from './seed/voting.json' with { type: 'json' };
import votedSeed from './seed/voted.json' with { type: 'json' };
import waitingSeed from './seed/waiting.json' with { type: 'json' };
import resultSeed from './seed/result.json' with { type: 'json' };
import type { ContentBody, ContentPage } from './blocks.js';

/** 사용자 제공 기준 카피. 개발·초기 seed 전용이며 법무 승인 상태와 무관하다. */
export interface ContentSeed {
  readonly page: ContentPage;
  readonly locale: 'ko';
  readonly status: 'DRAFT';
  readonly body: ContentBody;
}

export const CONTENT_SEEDS: readonly ContentSeed[] = [
  submissionSeed as ContentSeed,
  submittedSeed as ContentSeed,
  votingSeed as ContentSeed,
  votedSeed as ContentSeed,
  waitingSeed as ContentSeed,
  resultSeed as ContentSeed,
];

export function seedFor(page: ContentPage): ContentSeed | undefined {
  return CONTENT_SEEDS.find((seed) => seed.page === page);
}
