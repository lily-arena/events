import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
const publicPath='workers/public/.dev.vars',adminPath='workers/admin/.dev.vars';
for(const path of [publicPath,adminPath]) {try{await access(path);throw new Error('Local keys already exist; refusing to overwrite.');}catch(e){if(e.code!=='ENOENT')throw e;}}
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'der'}});
await writeFile(publicPath,`PII_PUBLIC_KEY=${publicKey.toString('base64')}\nIDENTITY_HMAC_KEY=${randomBytes(32).toString('hex')}\n`,{mode:0o600,flag:'wx'});
await writeFile(adminPath,`PII_PRIVATE_KEY=${privateKey.toString('base64')}\n`,{mode:0o600,flag:'wx'});
console.log('New local-only keys created in ignored files.');
