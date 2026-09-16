import {readFileSync,writeFileSync} from 'node:fs';
writeFileSync('packages/relay/src/generated-page-shell.ts','export default '+JSON.stringify(readFileSync('dist/events/index.html','utf8'))+';\n');
