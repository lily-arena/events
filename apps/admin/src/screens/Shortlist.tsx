import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { kst } from '../labels.js';

/**
 * 숏리스트.
 * 심사에서 '후보'로 지정한 문구가 자동으로 나타난다.
 * 권리 확인, 가중치, 동점 기준 입력은 없다. 확정은 목록을 한 번 확인하는 것이다.
 */

interface Entry {
  submissionId: string;
  message: string;
  order: number;
}

interface Shortlist {
  prepared: Entry[];
  confirmed: { candidateId: string; message: string; number: number }[];
  confirmedAt: number | null;
  stale: boolean;
  locked: boolean;
  setId: string | null;
  /** 지금 화면에 보이는 준비 목록의 지문. 확정할 때 함께 보낸다. */
  preparedDigest: string;
}

export function Shortlist({ navigate }: { navigate: (to: string) => void }): JSX.Element {
  const [data, setData] = useState<Shortlist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<Shortlist>('/api/admin/shortlist'));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const move = useCallback(
    async (index: number, delta: number) => {
      if (data === null) return;
      const next = [...data.prepared];
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      const a = next[index]!;
      next[index] = next[target]!;
      next[target] = a;
      setData({ ...data, prepared: next });
      setBusy(true);
      try {
        setData(await api.put<Shortlist>('/api/admin/shortlist/order', { order: next.map((e) => e.submissionId) }));
      } catch (moveError) {
        setError(moveError instanceof ApiError ? moveError.body.message : '순서를 바꾸지 못했습니다.');
        await load();
      } finally {
        setBusy(false);
      }
    },
    [data, load],
  );

  const confirm = useCallback(async () => {
    if (data === null) return;
    setBusy(true);
    setError(null);
    try {
      setData(
        await api.post<Shortlist>('/api/admin/shortlist/confirm', {
          // 지금 목록 그대로 확정되는지 서버가 확인한다.
          expectedPreparedDigest: data.preparedDigest,
        }),
      );
      setMessage('후보를 확정했습니다. 투표 시작은 대시보드에서 진행합니다.');
      setConfirming(false);
    } catch (confirmError) {
      setError(confirmError instanceof ApiError ? confirmError.body.message : '확정하지 못했습니다.');
      // 목록이 바뀌어 실패했으면 새 목록을 보여준다.
      if (confirmError instanceof ApiError && confirmError.status === 409) await load();
    } finally {
      setBusy(false);
    }
  }, [data, load]);

  if (data === null) {
    return error === null ? <p className="notice info">불러오는 중입니다.</p> : <p className="notice error">{error}</p>;
  }

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

      {data.locked && (
        <p className="notice warn">
          투표가 시작되어 후보를 바꿀 수 없습니다. 접수된 표와 후보의 연결을 유지해야 합니다.
        </p>
      )}
      {data.stale && (
        <p className="notice warn">후보가 변경되었습니다. 다시 확정해주세요.</p>
      )}

      <div className="panel">
        <div className="button-row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ margin: 0 }}>
              후보 {data.prepared.length}개
              {data.confirmedAt !== null && !data.stale && <span className="badge ok" style={{ marginLeft: 8 }}>확정됨</span>}
            </h3>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {data.confirmedAt === null
                ? '심사에서 후보로 지정하면 여기에 나타납니다.'
                : `${kst(data.confirmedAt)} 확정`}
            </p>
          </div>
          {!data.locked && (
            <button
              type="button"
              className="action primary"
              disabled={busy || data.prepared.length === 0}
              onClick={() => setConfirming(true)}
            >
              후보 확정
            </button>
          )}
        </div>

        {data.prepared.length === 0 ? (
          <p className="notice info">
            아직 후보가 없습니다.{' '}
            <button type="button" className="link-button" onClick={() => navigate('/submission/review')}>
              응모작 심사에서 후보를 지정
            </button>
            해주세요.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th className="tight">순서</th>
                  <th>문구</th>
                  {!data.locked && <th className="tight">순서 변경</th>}
                </tr>
              </thead>
              <tbody>
                {data.prepared.map((entry, index) => (
                  <tr key={entry.submissionId}>
                    <td className="tight">{String(index + 1).padStart(2, '0')}</td>
                    <td className="message">{entry.message}</td>
                    {!data.locked && (
                      <td className="tight">
                        <div className="button-row">
                          <button type="button" className="action small" disabled={busy || index === 0} onClick={() => void move(index, -1)}>
                            위로
                          </button>
                          <button
                            type="button"
                            className="action small"
                            disabled={busy || index === data.prepared.length - 1}
                            onClick={() => void move(index, 1)}
                          >
                            아래로
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirming && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setConfirming(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <div className="modal-header">
              <h3 id="confirm-title">이 문구들을 투표 후보로 확정하시겠습니까?</h3>
              <button type="button" className="action small" onClick={() => setConfirming(false)}>
                닫기
              </button>
            </div>
            <div className="modal-body">
              <ol className="confirm-list">
                {data.prepared.map((entry) => (
                  <li key={entry.submissionId}>{entry.message}</li>
                ))}
              </ol>
              <div className="button-row" style={{ marginTop: 16 }}>
                <button type="button" className="action primary" disabled={busy} onClick={() => void confirm()}>
                  후보 확정
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
