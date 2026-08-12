import test from "node:test";
import assert from "node:assert/strict";
import { deterministicAiFallback } from "../netlify/functions/ai-assistant.js";
import { getProductionConfig } from "../netlify/functions/_shared/production.js";

const coreEnv={SUPABASE_URL:"https://example.supabase.co",SUPABASE_ANON_KEY:"anon",SUPABASE_SERVICE_ROLE_KEY:"service"};

test("Lily has a deterministic free fallback with the existing chat response shape",()=>{
  const first=deterministicAiFallback({persona:"Lily",prompt:"What inventory should I reorder?"});
  const second=deterministicAiFallback({persona:"Lily",prompt:"What inventory should I reorder?"});
  assert.deepEqual(first,second);
  assert.equal(first.persona,"Lily");
  assert.equal(first.provider,"Florisyn local fallback");
  assert.match(first.answer,/low-stock/i);
});

test("generate fallback preserves the result response shape",()=>{
  const response=deterministicAiFallback({mode:"generate",task:"Draft product copy"});
  assert.equal(response.provider,"Florisyn local fallback");
  assert.equal(typeof response.result.text,"string");
});

test("production health recognizes the API token and both Stripe webhook secrets",()=>{
  const config=getProductionConfig({...coreEnv,CLOUDFLARE_ACCOUNT_ID:"acct",CLOUDFLARE_AI_API_TOKEN:"token",STRIPE_SECRET_KEY:"sk_test",STRIPE_WEBHOOK_SECRET:"whsec_subscription",STRIPE_ORDER_WEBHOOK_SECRET:"whsec_order"});
  assert.equal(config.features.ai_cloud,true);
  assert.equal(config.features.stripe_subscription_webhooks,true);
  assert.equal(config.features.stripe_order_webhooks,true);
  assert.equal(config.features.stripe_webhooks,true);
});

test("production health distinguishes a missing order webhook secret",()=>{
  const config=getProductionConfig({...coreEnv,STRIPE_SECRET_KEY:"sk_test",STRIPE_WEBHOOK_SECRET:"whsec_subscription"});
  assert.equal(config.features.stripe_subscription_webhooks,true);
  assert.equal(config.features.stripe_order_webhooks,false);
  assert.equal(config.features.stripe_webhooks,false);
  assert.ok(config.warnings.some(message=>message.includes("STRIPE_ORDER_WEBHOOK_SECRET")));
});
