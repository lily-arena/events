/** Only published titles and public URLs are exposed, never draft content. */
export async function publicCatalog(db:D1Database){
 const rows=await db.prepare("SELECT slug,json_extract(published_json,'$.title') AS title,home_active FROM events WHERE visibility='published' AND published_json IS NOT NULL ORDER BY created_at DESC,id").all<{slug:string;title:string;home_active:number}>();
 return rows.results.map(row=>({title:row.title,href:'/'+row.slug,active:row.home_active===1}));
}
