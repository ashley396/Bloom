# Florisyn Cost Control Plan

**Last updated:** 2026-07-30  
**Goal:** Keep infrastructure low-cost without weakening security or tenant isolation.

---

## Current stack (cost drivers)

| Service | Role | Tier assumption | Cost driver |
|---------|------|-----------------|-------------|
| Netlify | Hosting + 63 serverless functions | Free/Pro | Build minutes, function invocations, bandwidth |
| Supabase | Postgres + Auth + Storage | Free/Pro | DB size, auth MAU, storage GB, egress |
| Stripe | Payments | Pay per transaction | % + fixed fee per charge |
| Cloudflare Workers AI | Lily/Rose (preferred) | Usage-based | Tokens / requests |
| OpenAI | AI fallback | Usage-based | Tokens (if configured) |
| Google Maps | Delivery routing | Pay per request | `route-distance.js` calls |
| Local Ollama | Dev AI only | $0 on dev machine | Not production |

**Avoid adding:** duplicate analytics, second email vendor, second logging vendor, paid CDN unless Netlify limits hit.

---

## Free-tier risks

| Service | Limit | Risk | Mitigation |
|---------|-------|------|------------|
| Netlify functions | 125k invocations/mo (free) | Busy shop + webhooks | Batch reads; cache dashboard KPIs |
| Supabase DB | 500 MB (free) | Order/image growth | Archive old orders; compress images |
| Supabase auth | 50k MAU | Low for florists | Monitor |
| Supabase storage | 1 GB | Floral library photos | Compress uploads; max dimension cap |
| Cloudflare AI | Account quotas | Chat spikes | Rate limit AI endpoints; usage caps per shop |
| Google Maps | $200 credit/mo | High delivery volume | Cache routes; round-trip only on save |

---

## Suggested alert thresholds

Configure in owner monitoring (Netlify/Supabase dashboards or log drain):

| Metric | Warning | Critical |
|--------|---------|----------|
| Netlify function invocations | 80% of plan monthly | 95% |
| Supabase DB size | 70% of plan | 90% |
| AI requests / shop / day | 500 | 2000 |
| Storage upload size single file | 5 MB | Reject > 10 MB |
| Failed auth attempts / IP / hour | 20 | 50 (already rate limited) |
| Stripe webhook failures | 1% | 5% |

---

## What must remain paid for production safety

| Item | Why |
|------|-----|
| Supabase Pro (recommended) | PITR backups, higher limits, production SLA |
| Stripe | PCI scope — never roll own card storage |
| Custom domain + TLS | Netlify included; domain registrar fee |
| Transactional email (when live) | Deliverability for receipts/verification |
| Google Maps (if delivery routing) | Or accept manual mileage entry fallback |

**Do not downgrade:** RLS, webhook signature verification, or service-role isolation to save cost.

---

## Cost optimization tactics (implemented or planned)

| Tactic | Status | Files |
|--------|--------|-------|
| Single AI vendor preference (Cloudflare) | ✅ | `ai-status.js` |
| Feature flags disable expensive unfinished modules | ✅ | `feature-flags.js` |
| Open standards (JWT, Postgres, HTML) | ✅ | — |
| Image compression on upload | 🟡 Partial | Floral library admin |
| Safe caching of read-heavy dashboard | ⚪ Planned | `dashboard.js` |
| Batch background jobs | ⚪ Planned | Recipe deductions when flagged on |
| No duplicate analytics SDKs | ✅ | Stub hook only in SEO doc |
| esbuild bundling for functions | ✅ | `netlify.toml` |
| Local AI for dev only | ✅ | `local-ai-bridge/` |

---

## Usage caps (architecture)

Expose in platform admin (⚪ planned UI):

```json
{
  "shop_limits": {
    "ai_requests_per_day": 200,
    "storage_mb": 500,
    "sms_per_month": 0,
    "email_per_month": 1000
  }
}
```

Enforce in:

- `ai-assistant.js` — check cap before upstream call
- `floral-library-admin.js` — reject upload if over storage
- Future SMS/email functions

---

## Scaling checkpoints

| Trigger | Action |
|---------|--------|
| > 50 active shops | Supabase Pro + connection pooling |
| > 100k function invocations/mo | Netlify Pro; review cold starts |
| AI costs > $X/mo | Per-shop caps; disable voice features |
| Storage > 10 GB | CDN for public assets; image lifecycle policy |
| Multi-region latency | Evaluate Supabase region vs Netlify edge |

---

## Environment variables — cost-related

| Variable | Cost impact |
|----------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | AI usage |
| `OPENAI_API_KEY` | Fallback AI — disable if Cloudflare sufficient |
| `GOOGLE_MAPS_API_KEY` | Per-route charge |
| `STRIPE_SECRET_KEY` | Transaction fees only |
| `FLORISYN_FLAG_*` | Disable costly modules without deploy |

---

## Owner review cadence

- Monthly: Supabase + Netlify usage dashboards
- Quarterly: Dependency audit (`npm audit`), remove unused functions
- Before peak (Valentine's/Mother's Day): Load test orders + payment flow; pre-scale Supabase

---

*Premium feel does not require premium vendor sprawl — reuse the stack, cap usage, batch work.*
