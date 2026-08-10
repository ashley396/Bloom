# Florisyn — what to do now

Your chat history listed launch steps. **Most product work is already in the repo** (PR [#56](https://github.com/ashley396/Bloom/pull/56)). This file splits **done in code** vs **only you can do** in Stripe/Supabase/Netlify.

Run local checks anytime:

```bash
npm run verify:launch
```

Full production checklist: **`PUBLIC_LAUNCH_GUIDE.md`**

---

## Already built (merge PR #56)

| Item | Where |
|------|--------|
| Pricing **$59 / $99 / $149** + annual toggle | `/company/pricing/`, signup |
| Platform economics (MRR vs infra burn) | Admin HQ → Executive dashboard |
| Migration wizard | Settings → **Migration wizard** |
| Referral program | Settings → **Refer a florist** |
| Case studies | `/company/case-studies/` |
| Compare page | `/company/compare/` |
| Florist Network ($0 wire fee) | Florist Network page |
| Launch guide | `PUBLIC_LAUNCH_GUIDE.md` |

---

## You do these (cannot be automated)

### Today

1. **Merge PR #56** on GitHub and wait for Netlify deploy.
2. **Stripe** — create 6 prices ($59/$99/$149 monthly + annual) → copy Price IDs to Netlify env (see Step 4 in `PUBLIC_LAUNCH_GUIDE.md`).
3. **Stripe webhooks** — subscription + order endpoints + secrets in Netlify.
4. **Smoke-test production:**
   - `/company/pricing/` → `/signup` → create test account
   - Admin HQ → Platform economics panel
   - `GET /.netlify/functions/production-health`

### This week

5. **Supabase migrations** — apply chain in `PUBLIC_LAUNCH_GUIDE.md` Step 2 (if not already on staging/prod).
6. **Supabase Auth URLs** — Site URL + redirect allow list (Step 5 in launch guide).
7. **Recruit 1 pilot florist** — walk through: signup → first order → Settings → migration (if switching) → publish website.
8. **Replace case study placeholders** — edit `lib/growth/referral-program.js` → `CASE_STUDIES` with real shop names/quotes after pilots.

### Before peak season

9. **Supabase Pro** + confirm daily backups.
10. **Mother's Day readiness** — Holiday Command Center test with a busy shop scenario.
11. **Support plan** — who answers florist calls on peak weekends?

---

## Path to 500 shops (after pilots)

| Week | Focus |
|------|--------|
| 1–4 | 5 hand-onboarded shops, fix retention blockers |
| 5–8 | Referral links live, 2 written testimonials |
| 9–12 | Compare/pricing SEO, 1 state association or wholesaler intro |
| Ongoing | Florist Network density, case studies, peak-season proof |

---

## Money reminder (500 paying shops)

- **~$45k/mo** subscription revenue (typical mix)
- **~$900–1,000/mo** infrastructure vendors
- You do **not** lose money on hosting at that scale

---

## Need help?

- **Deploy/migrations:** `PUBLIC_LAUNCH_GUIDE.md`
- **Costs in admin:** Platform economics panel
- **Pricing tiers:** `/company/pricing/`
