import type {PageModule,Stage} from './model';
export type InputType='textarea'|'text'|'number'|'email'|'instagram'|'tel'|'select';
export type InputBinding='message'|'name'|'phone'|'email'|'instagram'|'extra';
export interface FormInput {id:string;binding:InputBinding;type:InputType;label:string;placeholder:string;help:string;maxLength:number;required:boolean;options:string[]}
export const inputTypeNames:Record<InputType,string>={textarea:'긴 텍스트',text:'텍스트',number:'숫자',email:'이메일',instagram:'인스타그램 ID',tel:'연락처',select:'선택 목록'};
export function inputTypes(binding:InputBinding):InputType[]{
 if(binding==='phone')return ['tel','text','number'];
 if(binding==='email')return ['email','text'];
 if(binding==='instagram')return ['instagram','text'];
 return binding==='extra'?Object.keys(inputTypeNames) as InputType[]:['textarea','text','number','email','instagram'];
}
export function inputLimit(binding:InputBinding){return binding==='message'?1000:binding==='name'?50:binding==='phone'?13:binding==='email'?254:binding==='instagram'?30:2000;}
export function formInputs(module:PageModule,stage:Stage,maxLength:number):FormInput[]{
 if(module.inputFields)return module.inputFields;
 const base=(binding:InputBinding,type:InputType,label:string,placeholder:string,limit:number):FormInput=>({id:binding,binding,type,label,placeholder,maxLength:limit,required:true,help:'',options:[]});
 return [...(stage==='submission'?[base('message','textarea','응모 문구','당신의 한 문장을 남겨주세요.',maxLength),base('name','text','이름','이름을 입력해주세요.',50)]:[]),...(module.fields??[]).map(f=>({...f,binding:'extra' as const,placeholder:'',help:''})),base('phone','tel','연락처','010-0000-0000',13),base('email','email','이메일','example@email.com',254),...(stage==='voting'?[{...base('instagram','instagram','인스타그램 계정','아이디를 입력해주세요.',30),help:'입력하신 정보는 공개되지 않습니다.'}]:[])];
}
export function inputName(field:FormInput){return field.binding==='extra'?'extra:'+field.id:field.binding;}
export function inputPattern(field:FormInput){
 if(field.binding==='phone'||field.type==='tel')return String.raw`0[0-9\-]{8,12}`;
 if(field.binding==='instagram'||field.type==='instagram')return '[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?';
 if(field.binding==='email'||field.type==='email')return String.raw`[^\s@]+@[^\s@.]+(\.[^\s@.]+)+`;
 if(field.type==='number')return String.raw`[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)`;
 return undefined;
}
/** Called before encryption; rejects requests that bypass the editable form constraints. */
export function validateFormValues(fields:FormInput[],values:Record<string,unknown>){
 for(const field of fields){const raw=values[inputName(field)]??'';if(typeof raw!=='string')throw new Error('입력 내용을 확인해주세요.');const value=raw.normalize('NFC').trim();const pattern=inputPattern(field);
 if((field.required&&!value)||value.length>field.maxLength||(value&&pattern&&!new RegExp(`^(?:${pattern})$`).test(value))||(value&&field.type==='select'&&!field.options.includes(value)))throw new Error(`${field.label} 항목을 확인해주세요.`);
 }
}
