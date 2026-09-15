import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, fetchMe, type Me } from './api.js';
import { useRoute } from './router.js';
import { canAccess, DEFAULT_PATH, findItem, visibleGroups } from './nav.js';
import { Dashboard } from './screens/Dashboard.js';
import { Review } from './screens/Review.js';
import { Shortlist } from './screens/Shortlist.js';
import { VoteStatus } from './screens/VoteStatus.js';
import { Content } from './screens/Content.js';
import { FinalMessage } from './screens/FinalMessage.js';
import { AuditLog } from './screens/AuditLog.js';
import { Privacy } from './screens/Privacy.js';
import { Notices } from './screens/Notices.js';

/**
 * 운영 화면 셸.
 * 주소로 화면을 정하고 권한에 맞는 메뉴만 보여준다.
 * 메뉴를 숨기는 것과 권한 검사는 별개이며 서버가 모든 요청을 다시 확인한다.
 */

/** 개발용 계정 전환은 로컬에서만 쓴다. */
const IS_LOCAL_DEV =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

/**
 * 참여자 화면 주소.
 * 참여자 화면과 운영 화면은 Vercel의 서로 다른 프로젝트라 주소가 다르다.
 * 빌드 시 VITE_PUBLIC_APP_URL로 주입하고, 로컬에서는 vite dev 주소를 기본으로 쓴다.
 */
function publicUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL;
  if (configured !== undefined && configured.length > 0) return configured;
  if (IS_LOCAL_DEV) {
    const override = new URLSearchParams(window.location.search).get('publicPort');
    return `http://localhost:${override ?? '5173'}/`;
  }
  // 운영에서는 참여자 화면 주소를 빌드 변수로 넣는다. 값이 없으면 링크를 쓰지 않는다.
  return '';
}

export function App(): JSX.Element {
  const { route, navigate } = useRoute();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMe(await fetchMe());
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.body.message : '로그인 상태를 확인하지 못했습니다.');
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 권한에 맞지 않는 주소로 들어오면 볼 수 있는 첫 화면으로 옮긴다.
  useEffect(() => {
    if (me === null) return;
    if (route.path === '/' || !canAccess(route.path)) {
      navigate(DEFAULT_PATH);
    }
  }, [me, route.path, navigate]);

  const groups = visibleGroups();
  const item = findItem(route.path);

  const nav = (
    <>
      <h1>FIRST SEAT 운영</h1>
      {groups.map((group) => (
        <div className="nav-group" key={group.title}>
          <p className="nav-group-title">{group.title}</p>
          {group.items.map((navItem) => (
            <button
              key={navItem.path}
              type="button"
              className={`nav-item${route.path === navItem.path ? ' active' : ''}`}
              onClick={() => {
                navigate(navItem.path);
                setDrawer(false);
              }}
            >
              {navItem.label}
            </button>
          ))}
        </div>
      ))}
    </>
  );

  return (
    <div className="layout">
      <nav className="sidebar">{nav}</nav>

      {drawer && (
        <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <nav className="drawer">{nav}</nav>
        </div>
      )}

      <main className="main">
        <div className="topbar">
          <div>
            <button type="button" className="action menu-button" onClick={() => setDrawer(true)}>
              메뉴
            </button>
            <h2>{item?.label ?? ''}</h2>
            <p className="page-desc">{item?.desc ?? ''}</p>
          </div>
          <div className="topbar-right">
            {me !== null && <span className="badge">{me.email}</span>}
          </div>
        </div>

        {error !== null && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}

        {me !== null && canAccess(route.path) && (
          <>
            {route.path === '/dashboard' && <Dashboard me={me} navigate={navigate} publicUrl={publicUrl()} />}
            {route.path === '/submission/review' && <Review />}
            {route.path === '/submission/content' && <Content scope="SUBMISSION" tabParam={route.query.get('tab')} />}
            {route.path === '/voting/candidates' && <Shortlist navigate={navigate} />}
            {route.path === '/voting/content' && <Content scope="VOTING" tabParam={route.query.get('tab')} />}
            {route.path === '/voting/monitor' && <VoteStatus />}
            {route.path === '/results/final' && <FinalMessage navigate={navigate} />}
            {route.path === '/results/content' && <Content scope="RESULT" tabParam={route.query.get('tab')} />}
            {route.path === '/settings/notices' && <Notices />}
            {route.path === '/settings/audit' && <AuditLog />}
            {route.path === '/settings/privacy' && <Privacy />}
          </>
        )}
      </main>
    </div>
  );
}
