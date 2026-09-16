import type {PageModule,Stage} from './model';
export interface ConsentItem {id:string;label:string;body:string}
export function consentItems(module:PageModule,stage:Stage):ConsentItem[]{return module.consents??[{id:'privacy',label:'개인정보 수집·이용에 동의합니다.',body:''},...(stage==='submission'?[{id:'work-license',label:'응모작 활용에 동의합니다.',body:''}]:[])];}
export function decodePolicy(body:string):{label?:string;body:string}{try{const value=JSON.parse(body);if(value.format==='events-consent-v1'&&typeof value.label==='string'&&typeof value.body==='string')return value;}catch{}return {body};}
export function encodePolicy(item:ConsentItem,privacyPolicy?:string){return JSON.stringify({...(privacyPolicy!==undefined?{privacyPolicy}:{}),format:'events-consent-v1',label:item.label,body:item.body});}
