import { useCallback, useEffect, useState } from 'react';
import { clearGuards, confirmLeave } from './unsaved.js';

/**
 * 주소 기반 화면 이동.
 * 새로고침·뒤로가기·직접 링크를 지원한다. 라우팅 라이브러리를 새로 넣지 않는다.
 *
 * 저장하지 않은 수정이 있으면 메뉴 이동과 뒤로가기 모두 확인을 거친다.
 */

export interface Route {
  readonly path: string;
  readonly query: URLSearchParams;
}

function current(): Route {
  const url = new URL(window.location.href);
  return { path: url.pathname, query: url.searchParams };
}

export function useRoute(): { route: Route; navigate: (to: string) => void } {
  const [route, setRoute] = useState<Route>(current);

  useEffect(() => {
    const onPop = () => {
      const leaving = current();
      if (!confirmLeave()) {
        // 취소했으면 원래 화면으로 되돌린다. 주소만 바뀐 채 남지 않게 한다.
        window.history.pushState(null, '', route.path + (route.query.toString() === '' ? '' : `?${route.query}`));
        return;
      }
      clearGuards();
      setRoute(leaving);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [route]);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    if (!confirmLeave()) return;
    clearGuards();
    window.history.pushState(null, '', to);
    setRoute(current());
    window.scrollTo({ top: 0 });
  }, []);

  return { route, navigate };
}
