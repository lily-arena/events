import React from 'react';
import {createRoot} from 'react-dom/client';
import {ParticipantTable} from '../../apps/admin/src/events/ParticipantTable';
import '../../apps/admin/src/events/admin.css';
import '../../packages/ui/src/tokens.css';
const event=new URLSearchParams(location.search).get('event')!;
createRoot(document.getElementById('root')!).render(<main className="operations-panel" style={{maxWidth:1100,margin:'32px auto',padding:16}}><ParticipantTable base={'events/'+event} onReveal={()=>{}} onDelete={()=>{}} busy={false} refreshKey=""/></main>);
