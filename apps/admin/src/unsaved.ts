import { useEffect } from 'react';

/**
 * 저장하지 않은 수정 보호.
 *
 * 화면 이동은 history.pushState로 처리하므로 beforeunload가 발생하지 않는다.
 * 그래서 메뉴 이동·탭 전환·뒤로가기까지 같은 기준으로 한 곳에서 막는다.
 *
 * 확인창에서 취소하거나 아무 응답이 없으면 이동하지 않는다. 저장한 것으로 간주하지 않는다.
 */

type Blocker = () => string | null;

const blockers = new Set<Blocker>();

/** 이 화면에 저장하지 않은 내용이 있으면 이동 전에 물어본다. */
export function useUnsavedGuard(hasUnsaved: boolean, message: string): void {
  useEffect(() => {
    if (!hasUnsaved) return;
    const blocker: Blocker = () => message;
    blockers.add(blocker);

    // 탭을 닫거나 새로고침하는 경우는 브라우저 기본 확인창을 쓴다.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      blockers.delete(blocker);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [hasUnsaved, message]);
}

/** 지금 떠나도 되는지 묻는다. 막을 이유가 없으면 true. */
export function confirmLeave(): boolean {
  for (const blocker of blockers) {
    const message = blocker();
    if (message === null) continue;
    if (!window.confirm(message)) return false;
  }
  return true;
}

/** 이동이 확정되면 남아 있는 보호를 비운다. 화면이 언마운트되며 정리되지만 순서를 보장한다. */
export function clearGuards(): void {
  blockers.clear();
}

export const UNSAVED_MESSAGE = '저장하지 않은 내용이 있습니다. 저장하지 않고 이동할까요?';
