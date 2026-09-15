import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';
import { DELETION_KIND_LABEL, DELETION_STATE_LABEL, kst, statusTone } from '../labels.js';

/**
 * 개인정보.
 * 가려진 목록과 원문 열람, 파기 현황을 다룬다. 화면 정리 작업과 섞지 않는다.
 * 원문은 재인증·사유·기록 경로로만 조회하며 대시보드 응답에는 담기지 않는다.
 */

interface SubmissionRow {
  id: string;
  message: string;
  acceptedAt: number;
  status: string;
}

interface MaskView {
  maskedName: string;
  maskedPhone: string;
  maskedEmail: string;
  retentionUntil: number;
  deleted: boolean;
}

interface Contact {
  name: string;
  phone: string;
  email: string;
}

interface DeletionStatus {
  id: string;
  targetId: string;
  kind: string;
  state: string;
  ledger: { event: string; occurredAt: number; restoreResidueUntil: number }[];
}

const LEDGER_LABEL: Readonly<Record<string, string>> = {
  INTENT: '파기 예고 보관',
  COMPLETE: '파기 완료 기록',
};

export function Privacy(): JSX.Element {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [mask, setMask] = useState<MaskView | null>(null);
  const [reason, setReason] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [kind, setKind] = useState('CONTACT');
  const [deleteReason, setDeleteReason] = useState('');
  const [job, setJob] = useState<DeletionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ rows: SubmissionRow[] }>('/api/admin/submissions?limit=100');
      setSubmissions(data.rows);
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (contact === null) return;
    setSecondsLeft(60);
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setContact(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    const onHide = () => setContact(null);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [contact]);

  const openMask = useCallback(async (id: string) => {
    setSelected(id);
    setMask(null);
    setContact(null);
    setReason('');
    if (id.length === 0) return;
    try {
      setMask(await api.get<MaskView>(`/api/admin/submissions/${id}/mask`));
    } catch (maskError) {
      setError(maskError instanceof ApiError ? maskError.body.message : '불러오지 못했습니다.');
    }
  }, []);

  const reveal = useCallback(async () => {
    if (selected.length === 0) return;
    setError(null);
    try {
      // 같은 로그인 세션에서 바로 연다. 열람 사실은 서버가 기록한다.
      setContact(await api.post<Contact>(`/api/admin/submissions/${selected}/reveal`, { reason }));
    } catch (revealError) {
      setError(revealError instanceof ApiError ? revealError.body.message : '열람하지 못했습니다.');
    }
  }, [selected, reason]);

  const createJob = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<{ id: string }>('/api/admin/deletions', {
        targetId: selected,
        kind,
        reason: deleteReason,
      });
      setJob(await api.get<DeletionStatus>(`/api/admin/deletions/${created.id}`));
      setMessage('파기를 예약했습니다. 정해진 시각에 자동으로 처리되며, 아래에서 지금 처리할 수도 있습니다.');
    } catch (createError) {
      setError(createError instanceof ApiError ? createError.body.message : '예약하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [selected, kind, deleteReason]);

  const runNow = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const summary = await api.post<{ deletion: { verified: number; failed: number } }>('/api/admin/jobs/run');
      setMessage(`파기 완료 ${summary.deletion.verified}건, 실패 ${summary.deletion.failed}건.`);
      if (job !== null) setJob(await api.get<DeletionStatus>(`/api/admin/deletions/${job.id}`));
      if (selected.length > 0) await openMask(selected);
    } catch (runError) {
      setError(runError instanceof ApiError ? runError.body.message : '처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [job, selected, openMask]);

  return (
    <>

      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message !== null && <p className="notice done">{message}</p>}

      <div className="panel">
        <h3>응모자 정보 확인</h3>
        <div className="row">
          <div>
            <label className="form-label" htmlFor="target">
              어떤 응모작인가요?
            </label>
            <select id="target" value={selected} onChange={(e) => void openMask(e.target.value)}>
              <option value="">응모작을 고르세요</option>
              {submissions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.message.slice(0, 24)} · {kst(row.acceptedAt)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {mask !== null && (
          <>
            {mask.deleted ? (
              <p className="notice info">이미 파기된 응모작입니다.</p>
            ) : (
              <p>
                {mask.maskedName} · {mask.maskedPhone} · {mask.maskedEmail}
                <span className="muted"> · 보유 기한 {kst(mask.retentionUntil)}</span>
              </p>
            )}
            {!mask.deleted && (
              <div className="row">
                <div>
                  <label className="form-label" htmlFor="reason">
                    열람 사유 (5자 이상)
                  </label>
                  <input
                    id="reason"
                    type="text"
                    placeholder="예: 당첨 안내 연락을 위해 확인"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <div className="grow-0">
                  <button type="button" className="action" disabled={reason.trim().length < 5} onClick={() => void reveal()}>
                    전체 내용 보기
                  </button>
                </div>
              </div>
            )}
            {contact !== null && (
              <div className="reveal-box">
                <p style={{ fontWeight: 600 }}>
                  {contact.name} · {contact.phone} · {contact.email}
                </p>
                <p className="muted">{secondsLeft}초 후 자동으로 사라집니다. 다른 곳에 옮겨 적지 마세요.</p>
              </div>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <h3>개인정보 파기</h3>
        <p className="panel-desc">
          보유 기한이 지난 연락처는 자동으로 파기 대기에 올라갑니다. 아래는 직접 예약할 때 사용합니다.
        </p>
        <div className="row">
          <div>
            <label className="form-label" htmlFor="kind">
              무엇을 지울까요?
            </label>
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(DELETION_KIND_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="delete-reason">
              사유
            </label>
            <input
              id="delete-reason"
              type="text"
              placeholder="예: 보유 기간이 끝나 파기"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
            />
          </div>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="action danger"
            disabled={busy || selected.length === 0 || deleteReason.trim().length < 3}
            onClick={() => {
              if (window.confirm('파기하면 되돌릴 수 없습니다. 계속할까요?')) void createJob();
            }}
          >
            위에서 고른 응모작의 정보 파기 예약
          </button>
          <button type="button" className="action" disabled={busy} onClick={() => void runNow()}>
            예약된 파기 지금 처리
          </button>
        </div>

        {job !== null && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3>
              {DELETION_KIND_LABEL[job.kind] ?? job.kind}{' '}
              <span className={`badge ${statusTone(job.state)}`}>{DELETION_STATE_LABEL[job.state] ?? job.state}</span>
            </h3>
            {job.ledger.map((entry, index) => (
              <p className="muted" key={index}>
                {LEDGER_LABEL[entry.event] ?? entry.event} · {kst(entry.occurredAt)} · 복구 이력 잔존{' '}
                {new Date(entry.restoreResidueUntil).toLocaleDateString('ko-KR')}까지
              </p>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
