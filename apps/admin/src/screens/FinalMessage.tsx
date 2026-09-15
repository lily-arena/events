import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { kst } from '../labels.js';

/**
 * 최종 문구 선정.
 * 투표 후보 중 하나를 골라 확정한다. 점수·비율·선정 근거는 쓰지 않는다.
 * 최다 득표가 아니어도 고를 수 있으며 결과 공개는 대시보드에서 한다.
 */

interface Row {
  candidateId: string;
  number: number;
  message: string;
  votes: number;
  rank: number;
}

interface Ranking {
  rows: Row[];
  included: number;
  countedAt: number;
  votingOpen: boolean;
}

interface Selection {
  resultId: string;
  candidateId: string;
  message: string;
  selectedAt: number;
  published: boolean;
}

export function FinalMessage({ navigate }: { navigate: (to: string) => void }): JSX.Element {
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rank, current] = await Promise.all([
        api.get<Ranking>('/api/admin/vote-ranking'),
        api.get<Selection | null>('/api/admin/final-message'),
      ]);
      setRanking(rank);
      setSelection(current);
      // 자동으로 첫 문구를 고르지 않는다. 이미 확정한 문구가 있으면 그것만 표시한다.
      setPicked(current?.candidateId ?? null);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirm = useCallback(async () => {
    if (picked === null) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.post<Selection>('/api/admin/final-message', {
        candidateId: picked,
        // 이 화면이 마지막으로 본 확정 문구. 그 사이에 바뀌었으면 서버가 덮어쓰지 않는다.
        expectedCurrentResultId: selection?.resultId ?? '',
      });
      setSelection(saved);
      setConfirming(false);
      setMessage('최종 문구가 확정되었습니다.');
    } catch (confirmError) {
      setError(confirmError instanceof ApiError ? confirmError.body.message : '확정하지 못했습니다.');
      // 경쟁으로 실패했으면 최신 상태를 다시 불러와 무엇이 확정되어 있는지 보여준다.
      if (confirmError instanceof ApiError && confirmError.status === 409) await load();
    } finally {
      setBusy(false);
    }
  }, [picked, selection, load]);

  if (ranking === null) {
    return error === null ? <p className="notice info">불러오는 중입니다.</p> : <p className="notice error">{error}</p>;
  }

  const pickedRow = ranking.rows.find((row) => row.candidateId === picked) ?? null;

  return (
    <>
      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message !== null && (
        <p className="notice done">
          {message}{' '}
          <button type="button" className="link-button" onClick={() => navigate('/dashboard')}>
            대시보드로 이동
          </button>
        </p>
      )}

      {selection !== null && (
        <div className="panel">
          <h3>
            현재 확정 문구{' '}
            <span className={`badge ${selection.published ? 'ok' : 'wait'}`}>
              {selection.published ? '공개 중' : '공개 전'}
            </span>
          </h3>
          <p style={{ fontSize: 18, fontWeight: 700, margin: '8px 0' }}>{selection.message}</p>
          <p className="muted">{kst(selection.selectedAt)} 확정</p>
          {selection.published && (
            <p className="notice warn" style={{ marginTop: 12 }}>
              이미 공개된 결과입니다. 다른 문구로 바꾸면 공개 중인 결과도 함께 바뀝니다.
            </p>
          )}
        </div>
      )}

      <div className="panel">
        <div className="button-row" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0 }}>
            {ranking.votingOpen ? '현재 투표 진행 중 · ' : ''}
            {kst(ranking.countedAt)} 기준 집계
          </p>
          <button type="button" className="action small" onClick={() => void load()}>
            새로고침
          </button>
        </div>

        {ranking.rows.length === 0 ? (
          <p className="notice info">확정된 투표 후보가 없습니다. 숏리스트에서 후보를 먼저 확정해주세요.</p>
        ) : (
          <>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th className="tight">선택</th>
                    <th className="tight">순위</th>
                    <th>문구</th>
                    <th className="tight">투표수</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.rows.map((row) => (
                    <tr key={row.candidateId}>
                      <td className="tight">
                        <input
                          type="radio"
                          name="final"
                          value={row.candidateId}
                          checked={picked === row.candidateId}
                          aria-label={`${row.message} 선택`}
                          onChange={() => setPicked(row.candidateId)}
                          style={{ width: 18, height: 18, minHeight: 18 }}
                        />
                      </td>
                      <td className="tight">{row.rank}</td>
                      <td className="message">{row.message}</td>
                      <td className="tight">{row.votes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="action primary"
              style={{ marginTop: 16 }}
              disabled={picked === null || busy}
              onClick={() => setConfirming(true)}
            >
              선택한 문구 확정
            </button>
          </>
        )}
      </div>

      {confirming && pickedRow !== null && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirming(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="final-title">
            <div className="modal-header">
              <h3 id="final-title">이 문구를 최종 문구로 확정하시겠습니까?</h3>
              <button type="button" className="action small" onClick={() => setConfirming(false)}>
                닫기
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 20, fontWeight: 700 }}>{pickedRow.message}</p>
              {ranking.votingOpen && (
                <p className="muted">현재 투표 진행 중 · {kst(ranking.countedAt)} 기준 집계입니다.</p>
              )}
              {selection?.published === true && (
                <p className="notice warn">이미 공개된 결과도 함께 변경됩니다.</p>
              )}
              <div className="button-row" style={{ marginTop: 16 }}>
                <button type="button" className="action primary" disabled={busy} onClick={() => void confirm()}>
                  최종 문구 확정
                </button>
                <button type="button" className="action" onClick={() => setConfirming(false)}>
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
