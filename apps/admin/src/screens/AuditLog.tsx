import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { AUDIT_ACTION_LABEL, kst } from '../labels.js';

/**
 * 운영 기록.
 * 사람이 한 일을 읽을 수 있는 문장으로 보여주고, 기술 식별자는 상세에서만 확인한다.
 * 개인정보 원문은 기록에 남지 않는다.
 */

interface AuditRow {
  id: string;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  occurredAt: number;
  outcome: string;
  reason: string | null;
  delivered: boolean;
  metadata?: Record<string, unknown>;
}

interface AuditList {
  rows: AuditRow[];
  nextCursor: string | null;
  pendingDelivery: number;
}

/** '담당자 B가 투표를 시작했습니다'처럼 읽히게 만든다. */
function sentence(row: AuditRow): string {
  const who = row.actorEmail ?? '참여자';
  const what = AUDIT_ACTION_LABEL[row.action] ?? row.action;
  if (row.actorEmail === null) return `${what}이(가) 있었습니다.`;
  if (row.action === 'CAMPAIGN_ACTION_EXECUTED') return `${who}가 공개 전환을 실행했습니다.`;
  if (row.action === 'CAMPAIGN_ACTION_REQUESTED') return `${who}가 공개 전환을 요청했습니다.`;
  if (row.action === 'CAMPAIGN_CLOSED_ON_SCHEDULE') return '예정된 마감 시각이 되어 자동으로 마감했습니다.';
  return `${who}가 ${what}을(를) 했습니다.`;
}

export function AuditLog(): JSX.Element {
  const [list, setList] = useState<AuditList | null>(null);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setList(await api.get<AuditList>('/api/admin/audit?limit=100'));
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = (list?.rows ?? []).filter((row) => {
    if (keyword.trim().length === 0) return true;
    const text = `${sentence(row)} ${row.reason ?? ''} ${row.actorEmail ?? ''}`;
    return text.includes(keyword.trim());
  });

  return (
    <>

      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <div className="panel">
        <div className="row">
          <div>
            <label className="form-label" htmlFor="keyword">
              검색
            </label>
            <input
              id="keyword"
              type="search"
              placeholder="담당자, 한 일, 사유로 찾기"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
          <div className="grow-0">
            <button type="button" className="action" onClick={() => void load()}>
              새로고침
            </button>
          </div>
        </div>
        {list !== null && (
          <p className="muted">
            {list.pendingDelivery > 0
              ? `D1에 저장되었으며 서명 확정을 기다리는 기록이 ${list.pendingDelivery}건 있습니다.`
              : '모든 기록이 D1에 저장되고 서명 확정을 마쳤습니다.'}
          </p>
        )}
      </div>

      <div className="panel">
        {rows.length === 0 && <p className="notice info">표시할 기록이 없습니다.</p>}
        {rows.map((row) => (
          <div className="card" key={row.id}>
            <h3>{sentence(row)}</h3>
            <p className="muted">
              {kst(row.occurredAt)}
              {row.outcome !== 'SUCCESS' && ' · 실패'}
              {!row.delivered && ' · 서명 확정 대기'}
            </p>
            {row.reason !== null && <p className="muted">사유: {row.reason}</p>}
            <button
              type="button"
              className="link-button"
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
            >
              {openId === row.id ? '상세 닫기' : '상세 보기'}
            </button>
            {openId === row.id && (
              <pre className="detail-block">
                {JSON.stringify(
                  { 기록: row.id, 대상: `${row.targetType}/${row.targetId ?? '-'}`, 내부코드: row.action },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
