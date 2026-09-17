/** Shared CDN caching only. Browsers must revalidate; no stale-on-error fallback. */
export function publicCacheHeaders(ttl:number):Record<string,string> {
 return {'Cache-Control':'public, max-age=0, must-revalidate','Vercel-CDN-Cache-Control':`public, s-maxage=${ttl}`};
}
export function publicReadCacheTtl(method:string,path:string,status:number,hasCookie=false):number {
 if(method!=='GET'||status!==200||hasCookie)return 0;
 if(/^\/api\/events\/[a-z0-9-]+$/.test(path))return 15;
 if(/^\/api\/events\/[a-z0-9-]+\/state$/.test(path))return 5;
 if(/^\/api\/events\/[a-z0-9-]+\/assets\/[a-f0-9-]+$/.test(path))return 60;
 return 0;
}
