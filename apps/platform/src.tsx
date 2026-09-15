import {createRoot} from 'react-dom/client';
import {StrictMode,lazy,Suspense} from 'react';
import '../../packages/ui/src/tokens.css';
const Admin=lazy(()=>import('../admin/src/events/AdminApp'));
const Public=lazy(()=>import('../public/src/events/PublicApp'));
createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={<p className="empty-state">화면을 준비하고 있습니다.</p>}>{location.pathname==='/admin'||location.pathname.startsWith('/admin/')?<Admin/>:location.pathname!=='/'?<Public/>:null}</Suspense></StrictMode>);
