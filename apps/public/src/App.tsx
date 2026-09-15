import { useCallback, useEffect, useRef, useState } from 'react';
import { resolvePublicView, type Campaign, type PublicView } from '@first-seat/domain';
import { blockItems, blockText } from '@first-seat/content';
import { ApiError, fetchCampaign } from './api.js';
import { SubmissionForm } from './SubmissionForm.js';
import { VotingScreen } from './VotingScreen.js';
import { ResultScreen } from './ResultScreen.js';

/**
 * Public shell. 단일 루트 URL을 유지하고 DB state로 화면을 전환한다.
 * API가 응답하기 전에 SUBMISSION으로 가정하지 않는다.
 */

type Screen = 'FORM' | 'SUBMITTED' | 'VOTED';

interface LoadState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly campaign: Campaign | null;
  readonly message: string;
}

const INITIAL: LoadState = { status: 'loading', campaign: null, message: '' };

function Footer(): JSX.Element {
  return (
    <div className="footer">
      <a href="/privacy">개인정보 처리방침</a>
      <a href="mailto:marketing.1@seoularena.net">문의</a>
    </div>
  );
}

function Loading(): JSX.Element {
  return (
    <div className="state-screen" aria-busy="true" aria-live="polite">
      <span className="visually-hidden">불러오는 중입니다.</span>
      <div className="skeleton" style={{ width: '40%', height: 48 }} />
      <div className="skeleton" style={{ width: '85%' }} />
      <div className="skeleton" style={{ width: '70%' }} />
      <div className="skeleton" style={{ width: '78%' }} />
    </div>
  );
}

interface StateScreenProps {
  readonly headline: string;
  readonly body: string;
  readonly schedule?: string | null;
}

/** 접수 전·접수 종료·투표 종료 등 참여할 수 없는 구간의 공통 화면. */
function StateScreen({ headline, body, schedule }: StateScreenProps): JSX.Element {
  return (
    <div className="state-screen">
      <h1 className="hero">FIRST SEAT</h1>
      <p className="state-headline">{headline}</p>
      <p>{body}</p>
      {schedule !== undefined && schedule !== null && <p className="state-schedule">{schedule}</p>}
    </div>
  );
}

/** 확정된 일정만 보여준다. 미정이면 아무것도 표시하지 않는다. */
function formatSchedule(label: string, at: number | null): string | null {
  if (at === null) return null;
  const text = new Date(at).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${label} ${text} (KST)`;
}

/**
 * 상황별 대기 문구의 CMS 항목 이름.
 * 운영자가 '공통 안내'에서 고친 문구를 그대로 쓰고, 없으면 아래 기본값을 쓴다.
 */
const WAITING_KEY: Partial<Record<PublicView, string>> = {
  PAUSED: 'paused',
  WAITING_SUBMISSION: 'waiting_submission',
  SUBMISSION_CLOSED: 'submission_closed',
  WAITING_VOTING: 'waiting_voting',
  VOTING_CLOSED: 'voting_closed',
};

/** CMS에 값이 없을 때만 쓰는 기본 문구. */
const WAITING_COPY: Readonly<Record<PublicView, { headline: string; body: string }>> = {
  LOADING: { headline: '', body: '' },
  PAUSED: {
    headline: '참여가 일시 중단되었습니다.',
    body: '잠시 후 다시 확인해주세요.',
  },
  WAITING_SUBMISSION: {
    headline: '문구 접수를 준비하고 있습니다.',
    body: '곧 첫 좌석에 새길 문장을 받습니다.',
  },
  SUBMISSION: { headline: '', body: '' },
  SUBMISSION_CLOSED: {
    headline: '문구 접수가 종료되었습니다.',
    body: '보내주신 문장을 살펴보며 후보작을 준비하고 있습니다.',
  },
  WAITING_VOTING: {
    headline: '투표를 준비하고 있습니다.',
    body: '후보 문구가 공개되면 안내해드리겠습니다.',
  },
  VOTING: { headline: '', body: '' },
  VOTING_CLOSED: {
    headline: '투표가 종료되었습니다.',
    body: '참여해주셔서 감사합니다. 결과를 준비하고 있습니다.',
  },
  RESULT: { headline: '', body: '' },
  ARCHIVED: {
    headline: '종료된 캠페인입니다.',
    body: '함께해주셔서 감사합니다.',
  },
};

export function App(): JSX.Element {
  const [state, setState] = useState<LoadState>(INITIAL);
  const [screen, setScreen] = useState<Screen>(() => {
    if (window.location.pathname === '/submitted') return 'SUBMITTED';
    if (window.location.pathname === '/voted') return 'VOTED';
    return 'FORM';
  });

  const requestSequence = useRef(0);
  const pending = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const lastRefresh = useRef(0);

  const load = useCallback((page?: string, background = false): Promise<void> => {
    const key = page ?? 'FORM';
    if (pending.current?.key === key) return pending.current.promise;
    // Focus and visibility events often fire together. Also avoid refetching on every click.
    lastRefresh.current = Date.now();
    const sequence = ++requestSequence.current;
    if (!background) setState((prev) => ({ ...prev, status: 'loading' }));
    const promise = (async () => {
      try {
        const campaign = await fetchCampaign(page);
        if (sequence !== requestSequence.current) return;
        setState({ status: 'ready', campaign, message: '' });
      } catch (error) {
        if (sequence !== requestSequence.current) return;
        if (error instanceof ApiError && error.status === 403 && (page === 'SUBMITTED' || page === 'VOTED')) {
          window.history.replaceState(null, '', '/');
          setScreen('FORM');
          return;
        }
        const message = error instanceof ApiError && error.status !== 503
          ? error.body.message : '잠시 후 다시 시도해주세요.';
        // A failed background check must not discard a participant's in-memory input.
        setState((prev) => background && prev.campaign !== null
          ? { ...prev, message }
          : { status: 'error', campaign: null, message });
      } finally {
        if (sequence === requestSequence.current) pending.current = null;
      }
    })();
    pending.current = { key, promise };
    return promise;
  }, []);

  useEffect(() => () => {
    requestSequence.current += 1;
    pending.current = null;
  }, []);

  useEffect(() => {
    if (screen === 'SUBMITTED') void load('SUBMITTED');
    else if (screen === 'VOTED') void load('VOTED');
    else void load();
  }, [load, screen]);

  // 브라우저 뒤로가기·앞으로가기로 주소가 바뀌면 그 화면을 다시 받는다.
  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      setScreen(path === '/submitted' ? 'SUBMITTED' : path === '/voted' ? 'VOTED' : 'FORM');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /*
   * 오래 열어둔 화면이 실제 단계와 어긋나지 않게 한다.
   * 탭으로 돌아올 때와 일정 간격마다 서버 상태를 다시 확인한다.
   * 최종 판단은 언제나 서버가 하며, 화면 갱신은 참여 가능 여부를 미리 알려주기 위한 것이다.
   */
  useEffect(() => {
    if (screen !== 'FORM') return;
    const refresh = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh.current >= 5_000) {
        void load(undefined, true);
      }
    };
    const onVisible = () => refresh();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.clearInterval(timer);
    };
  }, [load, screen]);

  const onAccepted = useCallback(() => {
    // 성공 응답을 받은 뒤에만 완료 화면을 보여준다. URL에 ID·문구·개인정보를 넣지 않는다.
    window.history.pushState(null, '', '/submitted');
    setScreen('SUBMITTED');
  }, []);

  const onVoted = useCallback(() => {
    // 투표를 마친 참여자에게 보여줄 화면. 이미 투표한 상태로 다시 들어와도 같은 화면으로 온다.
    if (window.location.pathname !== '/voted') {
      window.history.replaceState(null, '', '/voted');
    }
    setScreen('VOTED');
  }, []);

  const onBack = useCallback(() => {
    // history.back이 아니라 '/'로 이동해 빈 폼을 다시 받는다.
    window.location.assign('/');
  }, []);

  if (state.status === 'loading') {
    return (
      <main className="page">
        <div className="shell">
          <Loading />
        </div>
      </main>
    );
  }

  if (state.status === 'error' || state.campaign === null) {
    return (
      <main className="page">
        <div className="shell">
          <StateScreen headline="잠시 문제가 발생했습니다." body={state.message} />
          <button type="button" className="quiet-button" onClick={() => void load()}>
            다시 시도
          </button>
        </div>
      </main>
    );
  }

  const campaign = state.campaign;
  const blocks = campaign.content.blocks;

  if (screen === 'SUBMITTED' || screen === 'VOTED') {
    return (
      <main className="page">
        <div className="shell">
          <p className="brand">SEOUL ARENA</p>
          <div className="done">
            <h1>{blockText(blocks, 'headline')}</h1>
            {blockItems(blocks, 'lead').map((item, index) => (
              <p key={index}>{item}</p>
            ))}
            {/* 접수완료에는 '돌아가기'가 있고, 투표완료에는 돌아갈 화면이 없어 버튼을 두지 않는다. */}
            {blockText(blocks, 'back').length > 0 && (
              <button type="button" className="quiet-button" onClick={onBack}>
                {blockText(blocks, 'back')}
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  const view = resolvePublicView({
    state: campaign.state,
    paused: campaign.paused,
    serverTime: campaign.serverTime,
    submissionStart: campaign.submissionStart,
    submissionEnd: campaign.submissionEnd,
  });

  if (view === 'VOTING') {
    return (
      <main className="page">
        <div className="shell">
          <p className="brand">SEOUL ARENA</p>
          <VotingScreen campaign={campaign} onVoted={onVoted} />
          <Footer />
        </div>
      </main>
    );
  }

  if (view === 'RESULT') {
    return (
      <main className="page">
        <div className="shell">
          <p className="brand">SEOUL ARENA</p>
          <ResultScreen campaign={campaign} />
          <Footer />
        </div>
      </main>
    );
  }

  if (view !== 'SUBMISSION') {
    const fallback = WAITING_COPY[view];
    const cmsKey = WAITING_KEY[view];
    // 운영자가 고친 문구가 있으면 그것을 먼저 쓴다.
    const copy =
      cmsKey === undefined
        ? fallback
        : {
            headline: blockText(blocks, `${cmsKey}_headline`) || fallback.headline,
            body: blockText(blocks, `${cmsKey}_body`) || fallback.body,
          };
    // 다음 단계 일정이 확정된 경우에만 안내한다.
    const schedule =
      view === 'WAITING_SUBMISSION'
        ? formatSchedule('접수 시작', campaign.submissionStart)
        : view === 'SUBMISSION_CLOSED' || view === 'WAITING_VOTING'
          ? formatSchedule('투표 시작', campaign.votingStart)
          : null;
    return (
      <main className="page">
        <div className="shell">
          <p className="brand">SEOUL ARENA</p>
          <StateScreen headline={copy.headline} body={copy.body} schedule={schedule} />
          <Footer />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="shell">
        <p className="brand">SEOUL ARENA</p>
        {/* 개발 빌드에서만 보여준다. 실제 배포본에는 나오지 않는다. */}
        {import.meta.env.DEV && (
          <div className="dev-banner">
            로컬 개발 화면입니다. 테스트용 정보만 입력해주세요.
          </div>
        )}
        <h1 className="hero">{blockText(blocks, 'hero')}</h1>
        <div className="intro">
          {blockItems(blocks, 'intro').map((item, index) =>
            index === 0 ? (
              <p className="lead" key={index}>
                {item}
              </p>
            ) : (
              <p key={index}>{item}</p>
            ),
          )}
        </div>

        <SubmissionForm
          campaign={campaign}
          onAccepted={onAccepted}
          onConfigChanged={() => void load(undefined, true)}
        />
        <Footer />
      </div>
    </main>
  );
}
