import { json,bodyOf,preflight,methodNotAllowed } from "./_shared/http.js";
import { currentUser,fail,requireRoles } from "./_shared/supabase.js";
const fields=["name","phone","email","address","tagline","slug","logo_url","primary_color","accent_color","text_color","website_font","website_style","hero_title","hero_text","hero_image_url","about_text","social_facebook","social_instagram","custom_domain","website_published","homepage_sections","delivery_radius","default_delivery_fee","tax_rate","timezone","app_background_color","app_font","sidebar_color","header_color","dashboard_image_url","pos_tiles","register_name","register_id","receipt_header"];
const writableFields=fields.filter((field)=>field!=="website_published");
/**
 * P1 #7 (2026-09-28): every active member's POS / order builder / receipt
 * needs the shop's real tax rate, delivery fee and identity to PREVIEW the
 * totals the server will store — before this, only owner/manager could
 * read settings at all, so a cashier's screen fell back to a hard-coded
 * 6%. Non-privileged roles get exactly this read-only, non-sensitive
 * subset; every write (and the full settings read) stays owner/manager.
 */
export const MEMBER_READ_FIELDS=["name","phone","email","address","logo_url","primary_color","tax_rate","default_delivery_fee","timezone","receipt_header"];
const PRIVILEGED_ROLES=['owner', 'manager'];
export const handler=(event)=>handleSettings(event);
/** Test seam — production uses the bound real session helper via `handler`. */
export async function handleSettings(event,dependencies={}){
 const authenticate=dependencies.currentUser||currentUser;
 const ready=preflight(event);if(ready)return ready;
 try{const ctx=await authenticate(event);const {client,shopId}=ctx;const privileged=PRIVILEGED_ROLES.includes(ctx.role);
  if(event.httpMethod==="GET"){const cols=privileged?fields:MEMBER_READ_FIELDS;const {data,error}=await client.from("shops").select(cols.join(",")).eq("id",shopId).single();if(error)throw error;return json(200,{item:data,scope:privileged?"full":"member"});}
  requireRoles(ctx,PRIVILEGED_ROLES);
  if(event.httpMethod==="PATCH"){const body=bodyOf(event);if("website_published" in body)return json(409,{error:"Use Website Studio’s verified publish workflow to change the live-site status."});const payload={};for(const f of writableFields)if(f in body)payload[f]=body[f];if(!Object.keys(payload).length)return json(400,{error:"No supported settings were provided."});
   // P1 #7: the stored rate is what every order is taxed at — keep it a real percentage.
   if("tax_rate" in payload){const rate=Number(payload.tax_rate);if(payload.tax_rate===""||payload.tax_rate===null||!Number.isFinite(rate)||rate<0||rate>100)return json(400,{error:"Tax rate must be a percentage between 0 and 100."});payload.tax_rate=rate;}
   if("default_delivery_fee" in payload){const fee=Number(payload.default_delivery_fee);if(!Number.isFinite(fee)||fee<0)return json(400,{error:"Default delivery fee must be a number of 0 or more."});payload.default_delivery_fee=fee;}
   const {data,error}=await client.from("shops").update(payload).eq("id",shopId).select(fields.join(",")).single();if(error)throw error;return json(200,{item:data});}
  return methodNotAllowed();
 }catch(error){return fail(error)}
}
