import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
mkdirSync('api/generated',{recursive:true});
writeFileSync('api/generated/page-shell.ts','export default '+JSON.stringify(readFileSync('dist/events/index.html','utf8'))+';\n');
