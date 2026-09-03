# Marketing Premium AI Creative — Feature Flag Prep (Batch 1, Part 11)

**Status: NOT LIVE. Staging-only when activated.** No code change is
required to define this flag — it is a dynamic per-shop key inside the
EXISTING `shop_admin_config.features` JSONB column, read through the
EXISTING generic helper `isShopFeatureEnabled()` in
`netlify/functions/_shared/shop-feature-access.js` (the same mechanism
`marketing_studio_beta` already uses). Per Ashley's own instruction: "Do
not create another feature-flag system. If no code change is needed to
define a dynamic feature key, do not create unnecessary schema." No
migration, no new table, no new column — none is needed, and none was
added.

## The key

```
marketing_openai_premium_creative
```

Set the same way any other per-shop feature is set today — via the
existing admin-console `save_config` action writing into
`shop_admin_config.features`, e.g.:

```json
{ "features": { "marketing_studio_beta": true, "marketing_openai_premium_creative": true } }
```

## How a future caller would check it

Exactly the existing pattern `marketing-studio.js`'s own `featureGate()`
and `marketing-studio-shop.js` already use for `marketing_studio_beta` —
no new helper, no new call shape:

```js
import { isShopFeatureEnabled } from "./_shared/shop-feature-access.js";

const premiumCreativeEnabled = await isShopFeatureEnabled(
  shopId,
  "marketing_openai_premium_creative"
  // No globalFlagName passed — deliberately shop-scoped only, staging-
  // only for now. A future global rollout flag (mirroring MARKETING_STUDIO)
  // is a real, separate decision for whenever this goes broadly live —
  // not assumed here.
);
```

`isShopFeatureEnabled()` already fails closed on every ambiguous case (no
shopId, no config row, a missing key, a DB error) — exactly the same
honest "not enabled" behavior every other flag on this mechanism gets, no
new failure-handling logic needed.

## What this flag would gate, once wired up

This flag existing (in documentation, ready to use) is not the same as
anything checking it yet. As of Batch 1:

- No call site reads `marketing_openai_premium_creative`.
- No shop has this key set.
- `routeMarketingEngine()` (`marketing-engine-router.js`) does not check
  this flag at all — it is a pure decision function over the request's
  own concept, not an access gate. A future live call site would need to
  check this flag AND get `premium_ai_creative` back from the router AND
  have a configured OpenAI provider in the registry before ever making a
  real API call — three independent, all-must-pass conditions, matching
  this codebase's existing "no single flag is authorization by itself"
  principle (see `shop-feature-access.js`'s own module doc).

## Recommended activation sequence (for a future batch, not this one)

1. Enable the flag for exactly one staging/test shop.
2. Wire ONE real call site to check the flag + router + registry before
   calling `OpenAiMarketingImageProvider.generate()`.
3. Run real staging generations, capture actual OpenAI usage/cost via the
   already-built reconciliation path (`estimateOpenAiActualCostCentsFromUsage`
   in `marketing-cost-config.js`), and only then revisit the Part 14
   pricing-tier numbers with real data.
