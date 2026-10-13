import {createRoot} from 'react-dom/client';
import '../../../packages/ui/src/tokens.css';
import EventsLanding from '../../public/src/events/EventsLanding';
// Preview-only catalog fixture; production component uses its normal API.
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>input==='/api/events/catalog/list'?Promise.resolve(new Response(JSON.stringify([{title:'FIRST SEAT',href:'/first-seat',active:false}]),{headers:{'Content-Type':'application/json'}})):originalFetch(input,init);
createRoot(document.getElementById('root')!).render(<EventsLanding/>);
