import {createRoot} from 'react-dom/client';
import {StrictMode,lazy,Suspense} from 'react';
import '../../packages/ui/src/tokens.css';
const Admin=lazy(()=>import('../admin/src/events/AdminApp'));
const Public=lazy(()=>import('../public/src/events/PublicApp'));
document.title=location.pathname==='/admin'||location.pathname.startsWith('/admin/')?'서울아레나 이벤트 백오피스':'서울아레나 이벤트';
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={<p className="empty-state">화면을 준비하고 있습니다.</p>}>{location.pathname==='/admin'||location.pathname.startsWith('/admin/')?<Admin/>:location.pathname!=='/'?<Public/>:null}</Suspense></StrictMode>);
