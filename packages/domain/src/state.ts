/** 캠페인 상태와 허용 전이. BUILD_SPEC 7절. 이전 phase로 되돌리는 일반 전이는 없다. */
export const CAMPAIGN_STATES = [
  'DRAFT',
  'SUBMISSION_OPEN',
  'SUBMISSION_CLOSED',
  'VOTING_READY',
  'VOTING_OPEN',
  'VOTING_CLOSED',
  'RESULT_READY',
  'RESULT_PUBLISHED',
  'ARCHIVED',
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export const ALLOWED_TRANSITIONS: Readonly<Record<CampaignState, readonly CampaignState[]>> = {
  DRAFT: ['SUBMISSION_OPEN'],
  SUBMISSION_OPEN: ['SUBMISSION_CLOSED'],
  SUBMISSION_CLOSED: ['VOTING_READY'],
  VOTING_READY: ['VOTING_OPEN'],
  VOTING_OPEN: ['VOTING_CLOSED'],
  VOTING_CLOSED: ['RESULT_READY'],
  RESULT_READY: ['RESULT_PUBLISHED'],
  RESULT_PUBLISHED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransition(from: CampaignState, to: CampaignState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Public이 렌더링할 화면. state + paused + 시각으로만 결정하며 API 미응답을 SUBMISSION으로 가정하지 않는다. */
export type PublicView =
  | 'LOADING'
  | 'PAUSED'
  | 'WAITING_SUBMISSION'
  | 'SUBMISSION'
  | 'SUBMISSION_CLOSED'
  | 'WAITING_VOTING'
  | 'VOTING'
  | 'VOTING_CLOSED'
  | 'RESULT'
  | 'ARCHIVED';

export interface ViewInput {
  readonly state: CampaignState;
  readonly paused: boolean;
  readonly serverTime: number;
  readonly submissionStart: number | null;
  readonly submissionEnd: number | null;
}

export function resolvePublicView(input: ViewInput): PublicView {
  if (input.paused) return 'PAUSED';
  switch (input.state) {
    case 'DRAFT':
      return 'WAITING_SUBMISSION';
    case 'SUBMISSION_OPEN': {
      const { submissionStart: s, submissionEnd: e, serverTime: now } = input;
      // 시작 시각이 있고 아직 이르면 대기 화면
      if (s !== null && now < s) return 'WAITING_SUBMISSION';
      // [start, end) — 마감 시각 이후 신규 접수 불가. 마감이 없으면 계속 진행한다.
      if (e !== null && now >= e) return 'SUBMISSION_CLOSED';
      return 'SUBMISSION';
    }
    case 'SUBMISSION_CLOSED':
      return 'SUBMISSION_CLOSED';
    case 'VOTING_READY':
      return 'WAITING_VOTING';
    case 'VOTING_OPEN':
      return 'VOTING';
    case 'VOTING_CLOSED':
      return 'VOTING_CLOSED';
    case 'RESULT_READY':
      return 'VOTING_CLOSED';
    case 'RESULT_PUBLISHED':
      return 'RESULT';
    // 운영을 종료해도 공개된 결과는 그대로 둔다. 대시보드 확인 문구와 같은 정책이다.
    case 'ARCHIVED':
      return 'RESULT';
  }
}
