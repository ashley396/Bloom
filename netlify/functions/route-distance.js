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
    // Graceful degrade: mileage is an optional convenience. Without a maps key we return a
    // clear "unavailable" state (200) so the order/delivery flow is never blocked or shown a
    // raw config error. Enter mileage manually until a key is added in Netlify.
    if(!key){
      return json(200,{
        configured:false,
        origin:shop.address,
        destination:destination.trim(),
        oneWayMiles:null,roundTripMiles:null,driveMinutes:null,
        message:"Automatic mileage is unavailable until a maps key is added. Enter delivery miles manually for now."
      });
    }
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
