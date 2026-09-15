import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api.js';
import { kst } from '../labels.js';

/**
 * 대시보드.
 * 현재 공개 단계를 보여주고, 다음 단계로의 전환을 확인 한 번으로 실행한다.
 * 요청과 승인을 나누지 않으며 담당자 본인이 바로 처리한다.
 */

interface BlockedReason {
  key: string;
  message: string;
  resolutionHref: string | null;
}

interface ActionPreview {
  action: string;
  label: string;
  fromPublic: string;
  toPublic: string;
  participationAfter: string;
  periodAfter: { start: number | null; end: number | null };
  summary: { label: string; value: string }[];
  confirmList: string[];
  clearsStaleDeadline: boolean;
  blockedReasons: BlockedReason[];
  allowed: boolean;
  expectedRevision: number;
  /** 확인창에 보여준 내용의 지문. 실행할 때 함께 보내 서버가 대조한다. */
  snapshotDigest: string;
}

interface Dashboard {
  serverNow: number;
  campaignRevision: number;
  publicStatus: string;
  participation: string;
  paused: boolean;
  period: { label: string; start: number | null; end: number | null };
  nextAction: string | null;
  nextActionPreview: ActionPreview | null;
  counts: {
    submission: { total: number | null; pending: number | null; approved: number | null };
    voting: { candidates: number | null; received: number | null; included: number | null; needsReview: number | null };
    result: { published: boolean | null };
  };
  schedule: {
    submissionStart: number | null;
    submissionEnd: number | null;
    votingStart: number | null;
    votingEnd: number | null;
    maxMessageLength: number;
  };
}

interface Props {
  readonly me: { id: string; email: string };
  readonly navigate: (to: string) => void;
  readonly publicUrl: string;
}

function count(value: number | null): string {
  return value === null ? '확인 불가' : String(value);
}

function period(start: number | null, end: number | null): string {
  if (start === null && end === null) return '미정';
  if (end === null) return `${kst(start!)} 시작 · 마감 미정`;
  if (start === null) return `${kst(end)} 마감`;
  return `${kst(start)} ~ ${kst(end)}`;
}

export function Dashboard({ me, navigate, publicUrl }: Props): JSX.Element {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [resetRevision, setResetRevision] = useState(0);
  const [resetError, setResetError] = useState<string | null>(null);
  const resetId = useRef('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const view = await api.get<Dashboard>('/api/admin/dashboard');
      setData(view);
      setSyncedAt(Date.now());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '현황을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const execute = useCallback(async () => {
    const selected = data?.nextActionPreview;
    if (selected == null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/campaign-actions', {
        action: selected.action,
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: selected.expectedRevision,
        // 지금 확인창에 보이는 내용 그대로 공개되는지 서버가 확인한다.
        expectedSnapshotDigest: selected.snapshotDigest,
      });
      setMessage(`${selected.label}했습니다. 참여자 화면이 바뀌었습니다.`);
      setConfirming(false);
      await load();
    } catch (executeError) {
      setError(executeError instanceof ApiError ? executeError.body.message : '전환하지 못했습니다.');
      await load();
    } finally {
      setBusy(false);
    }
  }, [data, load ]);

  const togglePause = useCallback(async () => {
    if (data === null) return;
    setBusy(true);
    try {
      await api.post('/api/admin/campaign/pause', { paused: !data.paused });
      setMessage(data.paused ? '참여를 다시 열었습니다.' : '참여를 일시 중단했습니다.');
      await load();
    } catch (pauseError) {
      setError(pauseError instanceof ApiError ? pauseError.body.message : '변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [data, load]);

  if (data === null) {
    return error === null ? <p className="notice info">현황을 불러오는 중입니다.</p> : <p className="notice error">{error}</p>;
  }

  const preview = data.nextActionPreview;

  return (
    <>
      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message !== null && <p className="notice done">{message}</p>}

      <div className="panel status-panel">
        <div className="status-head">
          <div>
            <p className="muted" style={{ margin: 0 }}>
              지금 공개 중
            </p>
            <h3 className="status-title">{data.publicStatus}</h3>
            <div className="button-row">
              <span className={`badge ${data.participation === '참여 마감' || data.paused ? 'no' : 'ok'}`}>
                {data.participation}
              </span>
              {(data.period.start !== null || data.period.end !== null) && (
                <span className="muted">
                  {data.period.label} {period(data.period.start, data.period.end)}
                </span>
              )}
            </div>
          </div>
          <div className="button-row">
            <a className="action" href={publicUrl} target="_blank" rel="noreferrer">
              현재 공개 화면 보기
            </a>
            <button type="button" className="action" onClick={() => void load()}>
              새로고침
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          {syncedAt === null ? '아직 확인하지 않았습니다.' : `마지막 확인 ${kst(syncedAt)}`} · {me.email}
        </p>
      </div>

      {preview !== null && (
        <div className="panel action-panel">
          <h3>다음 단계: {preview.toPublic}</h3>
          {preview.allowed ? (
            <>
              <p className="panel-desc">
                확인 후 바로 전환됩니다.
                {preview.summary.some((s) => s.label === '함께 처리') && ' 진행 중인 접수도 함께 종료됩니다.'}
              </p>
              <button type="button" className="action primary" disabled={busy} onClick={() => { setConfirming(true); }}>
                {preview.label}
              </button>
            </>
          ) : (
            <>
              <ul className="check-list">
                {preview.blockedReasons.map((reason) => (
                  <li key={reason.key}>
                    <span className="badge wait">필요</span>
                    <span>
                      {reason.message}{' '}
                      {reason.resolutionHref !== null && (
                        <button type="button" className="link-button" onClick={() => navigate(reason.resolutionHref!)}>
                          바로 가기
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {confirming && preview !== null && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setConfirming(false); } }}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="action-title">
            <div className="modal-header">
              <h3 id="action-title">{preview.toPublic}로 전환하시겠습니까?</h3>
              <button type="button" className="action small" onClick={() => { setConfirming(false); }}>
                닫기
              </button>
            </div>
            <div className="modal-body">
              {preview.action === 'OPEN_VOTING' && (
                <p>아래 후보가 공개되며 참여자가 투표할 수 있습니다.</p>
              )}
              {preview.action === 'PUBLISH_RESULT' && <p>이 문구가 최종 결과로 공개됩니다.</p>}

              {preview.confirmList.length > 0 && (
                <ol className="confirm-list">
                  {preview.confirmList.map((text, index) => (
                    <li key={index}>{text}</li>
                  ))}
                </ol>
              )}

              <ul className="check-list" style={{ marginTop: 12 }}>
                {preview.summary.map((item) => (
                  <li key={item.label}>
                    <strong>{item.label}</strong>
                    <span>{item.value}</span>
                  </li>
                ))}
              </ul>

              <div className="button-row" style={{ marginTop: 16 }}>

                <button type="button" className="action primary" disabled={busy} onClick={() => void execute()}>
                  {preview.label}
                </button>
                <button type="button" className="action" onClick={() => { setConfirming(false); }}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resetStep > 0 && (
        <div className="modal-backdrop">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="reset-title">
            <div className="modal-header"><h3 id="reset-title">{resetStep === 1 ? '테스트 데이터를 초기화할까요?' : '정말 모두 삭제하고 공모를 시작할까요?'}</h3></div>
            <div className="modal-body">
              <p>현재 캠페인의 응모작, 응모자 개인정보와 동의 이력, 후보, 투표 내역, 최종 결과가 모두 삭제됩니다. 이 화면에서 되돌릴 수 없습니다.</p>
              <p>중복투표 제한도 초기화되어 같은 브라우저에서 다시 투표할 수 있습니다. 화면 문구·동의문 원문·관리자 계정·운영 기록은 유지됩니다.</p>
              <p>공모 접수를 다시 열며 공모·투표 마감 일정은 해제됩니다.</p>
              {resetError && <p className="notice error" role="alert">{resetError}</p>}
              <div className="button-row">
                <button type="button" className="action" autoFocus disabled={busy} onClick={() => setResetStep(0)}>취소</button>
                {resetStep === 1
                  ? <button type="button" className="action danger" onClick={() => setResetStep(2)}>삭제 범위 확인 · 다음</button>
                  : <button type="button" className="action danger" disabled={busy} onClick={async () => {
                    setBusy(true);
                    setResetError(null);
                    try {
                      await api.post('/api/admin/campaign/reset-test-data', {
                        expectedRevision: resetRevision, resetId: resetId.current,
                        confirmation: 'DELETE_TEST_DATA_AND_REOPEN',
                      });
                      setResetStep(0);
                      setMessage('테스트 데이터를 삭제하고 공모 접수를 다시 열었습니다.');
                      await load();
                    } catch (error) {
                      setResetError(error instanceof ApiError ? error.body.message : '초기화 결과를 확인하지 못했습니다. 다시 시도해주세요.');
                    } finally { setBusy(false); }
                  }}>{busy ? '초기화 중...' : '모두 삭제하고 공모 시작'}</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="summary-grid">
        <div className="panel">
          <h3>공모</h3>
          <ul className="check-list">
            <li>
              <strong>전체 접수</strong>
              <span>{count(data.counts.submission.total)}</span>
            </li>
            <li>
              <strong>검토 대기</strong>
              <span>{count(data.counts.submission.pending)}</span>
            </li>
          </ul>
          <button type="button" className="action small" onClick={() => navigate('/submission/review')}>
            응모작 심사로
          </button>
        </div>

        <div className="panel">
          <h3>투표</h3>
          <ul className="check-list">
            <li>
              <strong>확정 후보</strong>
              <span>{count(data.counts.voting.candidates)}</span>
            </li>
            <li>
              <strong>집계 포함 표</strong>
              <span>{count(data.counts.voting.included)}</span>
            </li>
          </ul>
          <div className="button-row">
            <button type="button" className="action small" onClick={() => navigate('/voting/candidates')}>
              숏리스트로
            </button>
            <button type="button" className="action small" onClick={() => navigate('/voting/monitor')}>
              투표 현황으로
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>결과</h3>
          <ul className="check-list">
            <li>
              <strong>공개</strong>
              <span>{data.counts.result.published === null ? '확인 불가' : data.counts.result.published ? '완료' : '전'}</span>
            </li>
          </ul>
          <button type="button" className="action small" onClick={() => navigate('/results/final')}>
            최종 문구 선정으로
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="button-row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>일정·기본 설정</h3>
          <button type="button" className="action small" onClick={() => setScheduleOpen((v) => !v)}>
            {scheduleOpen ? '접기' : '펼치기'}
          </button>
        </div>
        {scheduleOpen && (
          <ScheduleEditor
            schedule={data.schedule}
            revision={data.campaignRevision}
            onSaved={() => {
              setMessage('설정을 저장했습니다.');
              void load();
            }}
            onError={setError}
          />
        )}
        <div className="button-row" style={{ marginTop: 16 }}>
          <button type="button" className="action danger" disabled={busy} onClick={() => {
            resetId.current = crypto.randomUUID();
            setResetRevision(data.campaignRevision);
            setResetError(null);
            setResetStep(1);
          }}>공모로 돌아가기 · 테스트 데이터 초기화</button>
          <button type="button" className="action danger" disabled={busy} onClick={() => void togglePause()}>
            {data.paused ? '참여 다시 열기' : '참여 일시 중단'}
          </button>
          <span className="muted">
            {data.paused ? '재개해도 이미 지난 마감은 다시 열리지 않습니다.' : '참여만 잠시 막습니다. 단계는 그대로입니다.'}
          </span>
        </div>
      </div>
    </>
  );
}

/** 일정 편집. 시간은 한국 시간으로 다룬다. */
function ScheduleEditor({
  schedule,
  revision,
  onSaved,
  onError,
}: {
  schedule: Dashboard['schedule'];
  revision: number;
  onSaved: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [form, setForm] = useState(schedule);
  const [busy, setBusy] = useState(false);

  const toInput = (ms: number | null): string => {
    if (ms === null) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  };

  const fromInput = (value: string): number | null => {
    if (value.length === 0) return null;
    const ms = Date.parse(`${value}:00+09:00`);
    return Number.isNaN(ms) ? null : ms;
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.put('/api/admin/campaign/config', {
        maxMessageLength: form.maxMessageLength,
        submissionStart: form.submissionStart,
        submissionEnd: form.submissionEnd,
        votingStart: form.votingStart,
        votingEnd: form.votingEnd,
        absolutePiiDeadline: null,
        expectedRevision: revision,
      });
      onSaved();
    } catch (saveError) {
      onError(saveError instanceof ApiError ? saveError.body.message : '저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="panel-desc">시간은 모두 한국 시간(KST)입니다. 마감을 비워두면 수동으로 종료할 때까지 진행됩니다.</p>
      <div className="row">
        <div>
          <label className="form-label" htmlFor="sub-end">
            공모 마감
          </label>
          <input
            id="sub-end"
            type="datetime-local"
            value={toInput(form.submissionEnd)}
            onChange={(e) => setForm({ ...form, submissionEnd: fromInput(e.target.value) })}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="vote-end">
            투표 마감
          </label>
          <input
            id="vote-end"
            type="datetime-local"
            value={toInput(form.votingEnd)}
            onChange={(e) => setForm({ ...form, votingEnd: fromInput(e.target.value) })}
          />
        </div>
        <div>
          <label className="form-label" htmlFor="max-length">
            문구 최대 글자 수
          </label>
          <input
            id="max-length"
            type="number"
            min={1}
            max={100}
            value={form.maxMessageLength}
            onChange={(e) => setForm({ ...form, maxMessageLength: Number(e.target.value) })}
          />
        </div>
      </div>
      <button type="button" className="action" disabled={busy} onClick={() => void save()}>
        설정 저장
      </button>
    </>
  );
}
