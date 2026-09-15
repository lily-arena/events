import {handleGateway} from '../packages/relay/src/events.js';
export const config={runtime:'edge'};
export default function handler(request:Request){return handleGateway(request,{
 PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN??'https://events.seoularena.net',
 GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID??'',GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET??'',
 SESSION_SECRET:process.env.SESSION_SECRET??'',GATEWAY_SECRET:process.env.GATEWAY_SECRET??'',
 ADMIN_WORKER_URL:process.env.ADMIN_WORKER_URL??'',PUBLIC_WORKER_URL:process.env.PUBLIC_WORKER_URL??''
});}
