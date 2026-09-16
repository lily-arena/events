import shellHtml from '../packages/relay/src/generated-page-shell.js';
import {handlePage} from '../packages/relay/src/page.js';
export const config={runtime:'edge'};
export default function handler(request:Request){const origin=process.env.PUBLIC_ORIGIN??'https://events.seoularena.net';return handlePage(request,{
 PUBLIC_ORIGIN:origin,GOOGLE_CLIENT_ID:process.env.GOOGLE_CLIENT_ID??'',GOOGLE_CLIENT_SECRET:process.env.GOOGLE_CLIENT_SECRET??'',SESSION_SECRET:process.env.SESSION_SECRET??'',GATEWAY_SECRET:process.env.GATEWAY_SECRET??'',ADMIN_WORKER_URL:process.env.ADMIN_WORKER_URL??'',PUBLIC_WORKER_URL:process.env.PUBLIC_WORKER_URL??''
},shellHtml);}
