/** Only published metadata and operational dates; never draft copy or participant data. */
export async function publicCatalog(db:D1Database){
 const rows=await db.prepare(`SELECT e.slug,e.published_json,e.current_stage_id,e.home_active,
  e.started_at,e.ended_at
  FROM events e WHERE e.visibility='published' AND e.published_json IS NOT NULL
  ORDER BY e.created_at DESC,e.id`).all<{slug:string;published_json:string;current_stage_id:string;home_active:number;started_at:number|null;ended_at:number|null}>();
 return rows.results.map(row=>{
  const published=JSON.parse(row.published_json);
  const header=(published.pages?.[row.current_stage_id]??[]).find((m:{type:string})=>m.type==='header-image');
  const image=typeof header?.imageAssetId==='string'&&/^[a-f0-9-]{36}$/.test(header.imageAssetId)
   ? `/api/events/${row.slug}/assets/${header.imageAssetId}` : null;
  return {title:published.title,href:'/'+row.slug,active:row.home_active===1,image,
   startsAt:row.started_at,resultsAt:row.ended_at};
 });
}
