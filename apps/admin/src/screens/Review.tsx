import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { REVIEW_STATUS_LABEL, kst, statusTone } from '../labels.js';

/**
 * 응모작 심사.
 * 목록에서 상태를 바로 바꾼다. 검토 대기에서 후보로 곧바로 갈 수 있다.
 * '승인'은 분류일 뿐이며 다른 담당자의 결재가 아니다.
 */

interface ReviewRow {
  id: string;
  message: string;
  acceptedAt: number;
  status: string;
  reviewerNote: string;
  rowVersion: number;
}

interface ReviewList {
  rows: ReviewRow[];
  nextCursor: string | null;
  counts: { total: number; pending: number; approved: number; rejected: number; candidate: number };
}

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANDIDATE'] as const;

export function Review(): JSX.Element {
  const [list, setList] = useState<ReviewList | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (searchQuery: string, filterStatus: string) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.length > 0) params.set('q', searchQuery);
      if (filterStatus.length > 0) params.set('status', filterStatus);
      const data = await api.get<ReviewList>(`/api/admin/submissions?${params.toString()}`);
      setList(data);
      setNotes(Object.fromEntries(data.rows.map((row) => [row.id, row.reviewerNote])));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load('', '');
  }, [load]);

  const save = useCallback(
    async (row: ReviewRow, nextStatus: string, nextNote: string) => {
      setSavingId(row.id);
      setError(null);
      setRowMessage((prev) => ({ ...prev, [row.id]: '' }));
      try {
        await api.patch(`/api/admin/submissions/${row.id}`, {
          status: nextStatus,
          reviewerNote: nextNote,
          expectedRowVersion: row.rowVersion,
        });
        setRowMessage((prev) => ({ ...prev, [row.id]: '저장됨' }));
        await load(query, filter);
      } catch (saveError) {
        const text = saveError instanceof ApiError ? saveError.body.message : '저장하지 못했습니다.';
        setRowMessage((prev) => ({ ...prev, [row.id]: text }));
        if (saveError instanceof ApiError && saveError.status === 409) await load(query, filter);
      } finally {
        setSavingId(null);
      }
    },
    [load, query, filter],
  );

  const rows = list?.rows ?? [];

  return (
    <>
      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {list !== null && (
        <div className="counts">
          <div className="count-tile">
            <div className="count-label">전체</div>
            <div className="count-value">{list.counts.total}</div>
          </div>
          <div className="count-tile">
            <div className="count-label">검토 대기</div>
            <div className="count-value">{list.counts.pending}</div>
          </div>
          <div className="count-tile">
            <div className="count-label">승인</div>
            <div className="count-value">{list.counts.approved}</div>
          </div>
          <div className="count-tile">
            <div className="count-label">후보</div>
            <div className="count-value">{list.counts.candidate}</div>
          </div>
          <div className="count-tile">
            <div className="count-label">반려</div>
            <div className="count-value">{list.counts.rejected}</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="row">
          <div>
            <label className="form-label" htmlFor="q">
              문구 검색
            </label>
            <input
              id="q"
              type="search"
              placeholder="문구의 일부를 입력하세요"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void load(query, filter)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="filter">
              상태
            </label>
            <select
              id="filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                void load(query, e.target.value);
              }}
            >
              <option value="">전체 보기</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {REVIEW_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </div>
          <div className="grow-0">
            <button type="button" className="action" onClick={() => void load(query, filter)}>
              검색
            </button>
          </div>
        </div>
      </div>

      <div className="table-wrap desktop-table">
        <table>
          <thead>
            <tr>
              <th>문구</th>
              <th className="tight">접수 시각</th>
              <th className="tight">상태</th>
              <th>메모 (선택)</th>
              <th className="tight" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="message">{row.message}</td>
                <td className="tight muted">{kst(row.acceptedAt)}</td>
                <td className="tight">
                  <select
                    className={`status-select ${statusTone(row.status)}`}
                    value={row.status}
                    disabled={savingId === row.id}
                    aria-label="심사 상태"
                    onChange={(e) => void save(row, e.target.value, notes[row.id] ?? row.reviewerNote)}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {REVIEW_STATUS_LABEL[status]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    placeholder="필요하면 적어주세요"
                    value={notes[row.id] ?? ''}
                    disabled={savingId === row.id}
                    aria-label="심사 메모"
                    onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    onBlur={() => {
                      const next = notes[row.id] ?? '';
                      if (next !== row.reviewerNote) void save(row, row.status, next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                </td>
                <td className="tight muted">{rowMessage[row.id] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="notice info">표시할 응모작이 없습니다.</p>}
      </div>

      <div className="mobile-cards">
        {rows.map((row) => (
          <div className="card" key={row.id}>
            <h3>{row.message}</h3>
            <p className="muted">{kst(row.acceptedAt)}</p>
            <label className="form-label">상태</label>
            <select
              className={`status-select ${statusTone(row.status)}`}
              value={row.status}
              disabled={savingId === row.id}
              onChange={(e) => void save(row, e.target.value, notes[row.id] ?? row.reviewerNote)}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {REVIEW_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
            <label className="form-label" style={{ marginTop: 8 }}>
              메모 (선택)
            </label>
            <input
              type="text"
              value={notes[row.id] ?? ''}
              onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
              onBlur={() => {
                const next = notes[row.id] ?? '';
                if (next !== row.reviewerNote) void save(row, row.status, next);
              }}
            />
            {rowMessage[row.id] !== undefined && rowMessage[row.id] !== '' && (
              <p className="muted">{rowMessage[row.id]}</p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
