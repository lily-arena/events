import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../api.js';
import { kst } from '../labels.js';
import { UNSAVED_MESSAGE, confirmLeave, useUnsavedGuard } from '../unsaved.js';

/**
 * 화면 문구.
 * 페이지를 열면 지금 적용된 내용이 바로 입력칸에 보인다.
 * 고치고 '저장'을 누르면 반영된다. 초안 만들기·승인·게시 절차는 없다.
 */

type Page = 'SUBMISSION' | 'SUBMITTED' | 'VOTING' | 'VOTED' | 'WAITING' | 'RESULT';
export type ContentScope = 'SUBMISSION' | 'VOTING' | 'RESULT' | 'COMMON';

const SCOPE_PAGES: Readonly<Record<ContentScope, readonly { page: Page; tab: string; label: string }[]>> = {
  SUBMISSION: [
    { page: 'SUBMISSION', tab: 'main', label: '공모 화면' },
    { page: 'SUBMITTED', tab: 'completed', label: '접수 완료 화면' },
  ],
  VOTING: [
    { page: 'VOTING', tab: 'main', label: '투표 화면' },
    { page: 'VOTED', tab: 'completed', label: '투표 완료 화면' },
  ],
  RESULT: [{ page: 'RESULT', tab: 'main', label: '결과 발표 화면' }],
  COMMON: [{ page: 'WAITING', tab: 'main', label: '대기 안내 화면' }],
};

interface Field {
  key: string;
  type: string;
  label: string;
  text: string | null;
  items: string[] | null;
  legalReview: boolean;
}

interface Editor {
  page: Page;
  versionId: string | null;
  version: number;
  expectedVersion: number;
  fields: Field[];
  live: boolean;
  updatedAt: number | null;
}

/** 여러 줄 항목은 줄 단위로 편집한다. */
function toDraft(field: Field): string {
  return field.items === null ? (field.text ?? '') : field.items.join('\n');
}

export function Content({ scope, tabParam }: { scope: ContentScope; tabParam: string | null }): JSX.Element {
  const pages = SCOPE_PAGES[scope];
  const initial = pages.find((p) => p.tab === tabParam) ?? pages[0]!;
  const [page, setPage] = useState<Page>(initial.page);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowState, setRowState] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async (target: Page) => {
    setError(null);
    try {
      const data = await api.get<Editor>(`/api/admin/content?page=${target}`);
      setEditor(data);
      setDrafts(Object.fromEntries(data.fields.map((f) => [f.key, toDraft(f)])));
      setRowState({});
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const dirtyKeys = useMemo(() => {
    if (editor === null) return [];
    return editor.fields.filter((f) => (drafts[f.key] ?? '') !== toDraft(f)).map((f) => f.key);
  }, [editor, drafts]);

  // 저장하지 않은 내용이 있으면 메뉴 이동·뒤로가기·탭 닫기 모두에서 확인한다.
  useUnsavedGuard(dirtyKeys.length > 0, UNSAVED_MESSAGE);

  const saveField = useCallback(
    async (field: Field) => {
      if (editor === null) return;
      setBusyKey(field.key);
      setError(null);
      const value = drafts[field.key] ?? '';
      try {
        const payload: Record<string, unknown> = {
          page: editor.page,
          key: field.key,
          expectedVersion: editor.expectedVersion,
        };
        if (field.items === null) payload['text'] = value;
        else payload['items'] = value.split('\n').filter((line) => line.trim().length > 0);

        const updated = await api.put<Editor>('/api/admin/content/field', payload);
        setEditor(updated);
        setDrafts((prev) => ({
          ...Object.fromEntries(updated.fields.map((f) => [f.key, toDraft(f)])),
          // 다른 칸에 입력 중이던 내용은 지우지 않는다.
          ...Object.fromEntries(Object.entries(prev).filter(([key]) => key !== field.key && dirtyKeys.includes(key))),
        }));
        setRowState((prev) => ({ ...prev, [field.key]: '저장됨' }));
      } catch (saveError) {
        const text = saveError instanceof ApiError ? saveError.body.message : '저장하지 못했습니다.';
        setRowState((prev) => ({ ...prev, [field.key]: text }));
        if (saveError instanceof ApiError && saveError.status === 409) {
          setError('다른 곳에서 먼저 저장되었습니다. 최신 내용을 확인해주세요.');
        }
      } finally {
        setBusyKey(null);
      }
    },
    [editor, drafts, dirtyKeys],
  );

  /**
   * 바꾼 항목을 한 번에 저장한다.
   * 항목마다 따로 저장하면 첫 저장으로 버전이 올라가 나머지가 충돌하므로 한 요청으로 보낸다.
   */
  const saveAll = useCallback(async () => {
    if (editor === null || dirtyKeys.length === 0) return;
    setBusyKey('__all__');
    setError(null);
    const payloadFields = dirtyKeys.map((key) => {
      const field = editor.fields.find((f) => f.key === key);
      const value = drafts[key] ?? '';
      return field?.items === null || field === undefined
        ? { key, text: value }
        : { key, items: value.split('\n').filter((line) => line.trim().length > 0) };
    });
    try {
      const updated = await api.put<Editor>('/api/admin/content/fields', {
        page: editor.page,
        expectedVersion: editor.expectedVersion,
        fields: payloadFields,
      });
      setEditor(updated);
      setDrafts((prev) => ({
        ...Object.fromEntries(updated.fields.map((f) => [f.key, toDraft(f)])),
        // 저장하는 사이에 다른 칸에 입력한 내용은 지우지 않는다.
        ...Object.fromEntries(
          Object.entries(prev).filter(([key]) => !dirtyKeys.includes(key) && (prev[key] ?? '') !== ''),
        ),
      }));
      setRowState(Object.fromEntries(dirtyKeys.map((key) => [key, '저장됨'])));
    } catch (saveError) {
      const text = saveError instanceof ApiError ? saveError.body.message : '저장하지 못했습니다.';
      setError(text);
    } finally {
      setBusyKey(null);
    }
  }, [editor, dirtyKeys, drafts]);

  if (editor === null) {
    return error === null ? <p className="notice info">불러오는 중입니다.</p> : <p className="notice error">{error}</p>;
  }

  return (
    <>
      {pages.length > 1 && (
        <div className="panel">
          <div className="button-row">
            {pages.map((p) => (
              <button
                key={p.page}
                type="button"
                className={`action${p.page === page ? ' primary' : ''}`}
                onClick={() => {
                  // 같은 화면 안의 탭 전환도 저장하지 않은 내용을 잃게 하므로 같은 기준으로 확인한다.
                  if (!confirmLeave()) return;
                  setPage(p.page);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <p className={`notice ${editor.live ? 'done' : 'info'}`}>
        {editor.live
          ? '지금 참여자에게 보이는 화면입니다. 저장하면 바로 반영됩니다.'
          : '아직 공개 전인 화면입니다. 저장한 내용은 이 단계로 전환할 때 표시됩니다.'}
        {editor.updatedAt !== null && ` · 마지막 저장 ${kst(editor.updatedAt)}`}
      </p>

      <div className="panel">
        {editor.fields.map((field) => {
          const dirty = (drafts[field.key] ?? '') !== toDraft(field);
          const multiline = field.items !== null || field.type === 'policy';
          return (
            <div key={field.key} className="field-row">
              <label className="form-label" htmlFor={`f-${field.key}`}>
                {field.label}
              </label>
              {multiline ? (
                <textarea
                  id={`f-${field.key}`}
                  value={drafts[field.key] ?? ''}
                  rows={Math.min(12, Math.max(3, (drafts[field.key] ?? '').split('\n').length + 1))}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              ) : (
                <input
                  id={`f-${field.key}`}
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={drafts[field.key] ?? ''}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))}
                />
              )}
              {field.key === 'pii_retention_days' && <p className="muted">새로 접수되는 개인정보에 적용됩니다. 기존 기록의 기한은 바뀌지 않습니다. 경품 발송 등 이용 목적이 끝난 정보는 개인정보 메뉴에서 파기해주세요.</p>}
              {field.type === 'policy' && <p className="muted">저장하면 ‘자세히 보기’에 바로 반영됩니다. 이전 응모자의 동의문은 당시 버전으로 보존됩니다.</p>}
              <div className="button-row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="action small"
                  disabled={!dirty || busyKey === field.key}
                  onClick={() => void saveField(field)}
                >
                  저장
                </button>
                {field.items !== null && <span className="muted">한 줄에 항목 하나씩 적습니다.</span>}
                {rowState[field.key] !== undefined && <span className="muted">{rowState[field.key]}</span>}
              </div>
            </div>
          );
        })}

        {dirtyKeys.length > 1 && (
          <button type="button" className="action primary" style={{ marginTop: 12 }} onClick={() => void saveAll()}>
            저장하지 않은 {dirtyKeys.length}개 모두 저장
          </button>
        )}
      </div>
    </>
  );
}
