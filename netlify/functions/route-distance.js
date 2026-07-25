import { json, bodyOf, preflight, methodNotAllowed } from "./_shared/http.js";
import { currentUser, fail } from "./_shared/supabase.js";

export async function handler(event){
  const ready=preflight(event); if(ready)return ready;
  try{
    if(event.httpMethod!=="POST")return methodNotAllowed();
    const {client,shopId}=await currentUser(event);
    const {destination}=bodyOf(event);
    if(!destination?.trim()){const e=new Error("Delivery address is required");e.statusCode=400;throw e;}
    const {data:shop,error}=await client.from("shops").select("address").eq("id",shopId).single();
    if(error)throw error;
    if(!shop?.address?.trim()){const e=new Error("Add the shop address in Settings before calculating mileage.");e.statusCode=400;throw e;}
    const key=process.env.GOOGLE_MAPS_API_KEY;
    if(!key){const e=new Error("GOOGLE_MAPS_API_KEY is not configured in Netlify.");e.statusCode=503;throw e;}
    const response=await fetch("https://routes.googleapis.com/directions/v2:computeRoutes",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Goog-Api-Key":key,"X-Goog-FieldMask":"routes.distanceMeters,routes.duration"},
      body:JSON.stringify({origin:{address:shop.address},destination:{address:destination.trim()},travelMode:"DRIVE",routingPreference:"TRAFFIC_AWARE"})
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data?.error?.message||"Route calculation failed");
    const route=data.routes?.[0];
    if(!route)throw new Error("No driving route was found for that address.");
    const oneWayMiles=Number(route.distanceMeters||0)/1609.344;
    const driveMinutes=Number(String(route.duration||"0s").replace("s",""))/60;
    return json(200,{origin:shop.address,destination:destination.trim(),oneWayMiles,roundTripMiles:oneWayMiles*2,driveMinutes});
  }catch(error){return fail(error)}
}
