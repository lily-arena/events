import { useCallback, useEffect, useRef, useState } from 'react';
import { blockItems, blockText } from '@first-seat/content';
import type { Campaign } from '@first-seat/domain';
import {
  ApiError,
  castVote,
  fetchCandidates,
  fetchVoteStatus,
  startSession,
  startVoterSession,
  type CandidatesDto,
} from './api.js';
import { TurnstileError, getTurnstileToken } from './turnstile.js';

interface VotingScreenProps {
  readonly campaign: Campaign;
  readonly onVoted: () => void;
}

/**
 * Phase 2 투표. 후보별 득표율·실시간 참여수·plate preview를 노출하지 않는다.
 * 투표는 한 유효 session당 한 표이며 완료 후 변경할 수 없다.
 */
export function VotingScreen({ campaign, onVoted }: VotingScreenProps): JSX.Element {
  const blocks = campaign.content.blocks;
  const [data, setData] = useState<CandidatesDto | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [alreadyVoted, setAlreadyVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 확인창 안에서 보여줄 오류. 창을 닫지 않고 그 자리에서 알린다. */
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const csrfRef = useRef<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [candidates, status] = await Promise.all([fetchCandidates(), fetchVoteStatus()]);
        if (cancelled) return;
        setData(candidates);
        setAlreadyVoted(status.voted);
        // 이미 투표를 마쳤다면 투표 화면 대신 완료 화면을 보여준다.
        if (status.voted) onVoted();
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof ApiError ? loadError.body.message : '잠시 후 다시 시도해주세요.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onVoted]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const submit = useCallback(async () => {
    if (data === null || selected === null || submitting) return;
    setSubmitting(true);
    setError(null);
    setConfirmError(null);
    try {
      if (csrfRef.current === null) csrfRef.current = (await startSession()).csrfToken;
      // 발급용 token으로 voter session을 먼저 확보한 뒤 투표용 token으로 제출한다.
      // 두 단계는 서로 다른 action이며 token을 돌려쓰지 않는다.
      const sessionToken = await getTurnstileToken(campaign.turnstileSiteKey, 'voter_session');
      await startVoterSession(csrfRef.current, sessionToken);
      if (idempotencyKeyRef.current === null) idempotencyKeyRef.current = crypto.randomUUID();
      const voteToken = await getTurnstileToken(campaign.turnstileSiteKey, 'vote');
      await castVote(selected, data.setId, csrfRef.current, idempotencyKeyRef.current, voteToken);
      idempotencyKeyRef.current = null;
      // 성공하면 확인창을 닫고 완료 화면으로 넘어간다.
      setConfirming(false);
      onVoted();
    } catch (voteError) {
      idempotencyKeyRef.current = null;
      if (voteError instanceof ApiError) {
        if (voteError.body.code === 'ALREADY_VOTED') {
          // 이미 투표를 마친 참여자는 완료 화면으로 보낸다.
          setConfirming(false);
          setAlreadyVoted(true);
          onVoted();
        } else {
          if (voteError.body.code === 'CSRF_FAILED' || voteError.body.code === 'UNAUTHENTICATED') {
            csrfRef.current = null;
          }
          // 확인창을 연 채로 그 안에서 알린다.
          setConfirmError(voteError.body.message);
        }
      } else if (voteError instanceof TurnstileError) {
        // 보안 확인이 실패·만료된 경우다. 확인창 안에서 알리고 다시 시도하게 한다.
        setConfirmError(voteError.message);
      } else {
        setConfirmError('네트워크 상태를 확인한 뒤 다시 시도해주세요.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [data, selected, submitting, onVoted]);

  if (error !== null && data === null) {
    return (
      <div className="state-screen">
        <p>{error}</p>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="state-screen" aria-busy="true">
        <div className="skeleton" style={{ width: '60%' }} />
        <div className="skeleton" style={{ width: '80%' }} />
      </div>
    );
  }

  const selectedCandidate = data.candidates.find((c) => c.id === selected) ?? null;

  return (
    <>
      <h1 className="hero">{blockText(blocks, 'hero')}</h1>
      <div className="intro">
        {blockItems(blocks, 'intro').map((item, index) => (
          <p className={index === 0 ? 'lead' : undefined} key={index}>
            {item}
          </p>
        ))}
      </div>

      <section aria-label="후보 문구">
        <ul className="candidate-list">
          {data.candidates.map((candidate) => (
            <li key={candidate.id}>
              <label className={`candidate${selected === candidate.id ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="candidate"
                  value={candidate.id}
                  checked={selected === candidate.id}
                  disabled={alreadyVoted}
                  onChange={() => setSelected(candidate.id)}
                />
                <span className="candidate-number">{String(candidate.number).padStart(2, '0')}</span>
                <span className="candidate-message">{candidate.message}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {alreadyVoted ? (
        <p className="form-status" role="status">
          이미 투표에 참여하셨습니다.
        </p>
      ) : (
        <button type="button" className="submit" disabled={selected === null || submitting} onClick={() => setConfirming(true)}>
          {blockText(blocks, 'vote_submit') || '선택한 문구에 투표하기'}
        </button>
      )}
      {error !== null && (
        <div className="form-status" role="alert">
          {error}
        </div>
      )}

      <section aria-labelledby="voting-notices-heading">
        <h2 id="voting-notices-heading">{blockText(blocks, 'notices_heading')}</h2>
        <ul className="notice-list">
          {blockItems(blocks, 'notices').map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </section>

      {confirming && selectedCandidate !== null && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setConfirming(false);
              setConfirmError(null);
            }
          }}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="modal-header">
              <h2 id="confirm-title">선택한 문구를 확인해주세요</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => {
                  setConfirming(false);
                  setConfirmError(null);
                }}
              >
                취소
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>{selectedCandidate.message}</p>
              <p>투표 완료 후 변경할 수 없습니다.</p>
              {confirmError !== null && (
                <p className="modal-error" role="alert">
                  {confirmError}
                </p>
              )}
              <button
                type="button"
                className="submit"
                ref={confirmRef}
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? '처리 중...' : confirmError !== null ? '다시 시도' : '투표하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
