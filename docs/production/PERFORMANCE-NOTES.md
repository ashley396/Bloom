# Performance review (Production Readiness v1)

## Findings

| Area | Observation | Recommendation |
|------|-------------|----------------|
| `app.js` | Large single bundle | Defer page loaders later; already split marketplace/wholesale |
| List GETs | Orders/inventory unbounded | Add `limit` + cursor in v2 |
| Dashboard | Parallel loads on login | Acceptable; watch slow shops |
| Images | Product/marketplace | Lazy load + gallery (Launch Polish) |
| API | Repeated GET settings | Optional 4s GET cache in Launch Polish |
| AI | LLM payloads | `safeAiPayload` redacts secrets — keep using |

## Bundle size

No new heavy npm deps in this milestone. Netlify functions tree-shake per handler.

## Slow queries

Command Center dashboards cap at 500 rows. Add indexes on `shop_id, created_at` where advisors flag seq scans.
