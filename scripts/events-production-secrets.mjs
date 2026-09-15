import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {writeFile,access} from 'node:fs/promises';
const path='.env.events-production.json';
try{await access(path);throw new Error('Production keys already exist; refusing to overwrite.');}catch(error){if(error.code!=='ENOENT')throw error;}
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'der'},privateKeyEncoding:{type:'pkcs8',format:'der'}});
const secrets={GATEWAY_SECRET:randomBytes(32).toString('hex'),SESSION_SECRET:randomBytes(32).toString('hex'),IDENTITY_HMAC_KEY:randomBytes(32).toString('hex'),PII_PUBLIC_KEY:publicKey.toString('base64'),PII_PRIVATE_KEY:privateKey.toString('base64')};
await writeFile(path,JSON.stringify(secrets),{mode:0o600,flag:'wx'});
await writeFile('.env.events-public.json',JSON.stringify({GATEWAY_SECRET:secrets.GATEWAY_SECRET,IDENTITY_HMAC_KEY:secrets.IDENTITY_HMAC_KEY,PII_PUBLIC_KEY:secrets.PII_PUBLIC_KEY}),{mode:0o600,flag:'wx'});
await writeFile('.env.events-admin.json',JSON.stringify({GATEWAY_SECRET:secrets.GATEWAY_SECRET,PII_PRIVATE_KEY:secrets.PII_PRIVATE_KEY}),{mode:0o600,flag:'wx'});
console.log('New platform keys generated in ignored, owner-readable files. No original project keys used.');
