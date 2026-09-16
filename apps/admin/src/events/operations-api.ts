export class AdminRequestError extends Error {
 constructor(message:string,public status:number,public code?:string){super(message);this.name="AdminRequestError";}
}
export async function adminRequest<T>(path:string,method='GET',body?:unknown):Promise<T> {
 const response=await fetch('/api/admin/'+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();
 if(!response.ok)throw new AdminRequestError(result.error??result.message??'요청을 처리하지 못했습니다.',response.status,result.code);
 return result as T;
}
