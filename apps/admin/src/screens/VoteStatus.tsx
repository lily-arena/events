import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { kst } from '../labels.js';

/**
 * 투표 현황.
 * 집계 포함 투표수 내림차순으로 보여준다. 동률은 같은 순위를 주고 다음 순위를 건너뛴다.
 * 가중 점수는 표시하지 않는다.
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
  received: number;
  included: number;
  excluded: number;
  needsReview: number;
  countedAt: number;
  votingOpen: boolean;
}

export function VoteStatus(): JSX.Element {
  const [data, setData] = useState<Ranking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.get<Ranking>('/api/admin/vote-ranking'));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

      <div className="counts">
        <div className="count-tile">
          <div className="count-label">집계 포함</div>
          <div className="count-value">{data.included}</div>
        </div>
        <div className="count-tile">
          <div className="count-label">전체 접수</div>
          <div className="count-value">{data.received}</div>
        </div>
        {data.needsReview > 0 && (
          <div className="count-tile">
            <div className="count-label">확인 필요</div>
            <div className="count-value">{data.needsReview}</div>
          </div>
        )}
        {data.excluded > 0 && (
          <div className="count-tile">
            <div className="count-label">제외</div>
            <div className="count-value">{data.excluded}</div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="button-row" style={{ justifyContent: 'space-between' }}>
          <p className="muted" style={{ margin: 0 }}>
            {kst(data.countedAt)} 기준 · 투표 1위가 자동으로 최종 선정되는 것은 아닙니다.
          </p>
          <button type="button" className="action small" onClick={() => void load()}>
            새로고침
          </button>
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th className="tight">순위</th>
                <th>문구</th>
                <th className="tight">투표수</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.candidateId}>
                  <td className="tight">{row.rank}</td>
                  <td className="message">{row.message}</td>
                  <td className="tight">{row.votes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.rows.length === 0 && <p className="notice info">아직 확정된 후보가 없습니다.</p>}
      </div>
    </>
  );
}
