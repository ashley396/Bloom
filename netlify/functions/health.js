import { json } from "./_shared/http.js";
import { getProductionConfig } from "./_shared/production.js";

export async function handler(){
  const config=getProductionConfig(process.env);
  return json(config.environment_valid?200:503,{ok:config.environment_valid,app:"Florisyn",missing:config.missing_env,warnings:config.warnings,production_health:"/.netlify/functions/production-health"});
}
