# Florisyn Governance Map

**How to Navigate the Florisyn Documentation**

**Last updated:** 2026-07-30  
**Status:** Permanent — entry point for all Florisyn project documentation  
**Audience:** Owners, engineers, agents, and contributors

This document appears at the beginning of `FLORISYN_MASTER_ARCHITECTURE_BIBLE.md` and serves as the **entry point** for the Florisyn documentation constitution.

---

## Which document should I use?

### How should the platform be engineered?

➡ **`FLORISYN_MASTER_ARCHITECTURE_BIBLE.md`**

Defines:

- Overall platform architecture
- Core services
- Data model
- Engineering standards
- Agent rules
- Long-term roadmap

---

### What principles override every decision?

➡ **`FLORISYN_GOLD_STANDARD.md`**

Defines:

- Ten permanent product principles
- Decision hierarchy
- Single Source of Truth
- Florist First
- Recovery Before Speed
- Future Ecosystem

---

### How should Florisyn look and feel?

➡ **`FLORISYN_EXPERIENCE_STANDARD.md`**

Defines:

- UX philosophy
- Visual language
- Layout standards
- Orders presentation
- Accessibility
- Performance expectations
- Completion gate

---

### How should UI components be built?

➡ **`FLORISYN_DESIGN_SYSTEM.md`**

Defines:

- Design tokens
- Shared components
- Layout patterns
- Responsive behavior
- Accessibility implementation
- Reusable UI rules

---

### How do the portals fit together?

➡ **`FLORISYN_ECOSYSTEM_PORTALS_STANDARD.md`**

Defines:

- Florist Portal
- Wholesaler Portal
- Platform Owner Portal
- Shared platform services
- Shared design language

**Service ownership by portal:** `FLORISYN_PORTAL_OWNERSHIP_MATRIX.md` — who owns, manages, or consumes each shared service (Customers, Products, Orders, etc.).

---

### How is Website Studio designed?

➡ **`FLORISYN_WEBSITE_STUDIO_BLUEPRINT.md`**

Defines:

- Architecture
- Roadmap
- Future implementation phases
- Publishing model
- AI-assisted website generation

---

### What must be complete before release?

➡ **`FLORISYN_MASTER_BUILD_CHECKLIST.md`**

Defines:

- Feature completion
- Documentation status
- Release readiness
- Verification tracking
- Production gates

**RC1 deploy package:** `FLORISYN_RC1_FINAL_READINESS_REPORT.md` + `FLORISYN_RC1_OWNER_DEPLOYMENT_CHECKLIST.md`

---

## Documentation hierarchy

Read top-down. Lower documents must not contradict higher ones.

```
1. Master Architecture Bible     ← engineering & integration index
2. Gold Standard                 ← product principles (override decisions)
3. Experience Standard           ← UX & visual constitution
4. Design System                 ← tokens & components
5. Ecosystem Portals Standard    ← Florist / Wholesaler / Platform Owner
   Portal Ownership Matrix       ← who owns each shared service (companion)
6. Website Studio Blueprint      ← Website Studio permanent spec
7. Master Build Checklist        ← ship status & release gates
```

Together these documents form the **permanent constitution for Florisyn**.

**Rule:** No implementation should contradict a higher-level document.

| If conflict between… | Higher authority wins |
|----------------------|------------------------|
| Code vs Gold Standard §1 (Single Source of Truth) | Gold Standard |
| UX polish vs Recovery Before Speed | Gold Standard §6 |
| Visual choice vs Experience Standard | Experience Standard |
| Component one-off vs Design System tokens | Design System |
| Portal-specific fork vs Ecosystem Portals shared services | Ecosystem Portals |
| Feature ship vs Build Checklist gate | Build Checklist (until owner sign-off) |

When unresolved, escalate to owner.

---

## Related operational docs (outside the constitution)

These support production but do not override the hierarchy above:

| Document | Use when |
|----------|----------|
| `STACKED_RELEASE_READINESS_REPORT.md` | Stacked release verification |
| `STACKED_RELEASE_OWNER_CHECKLIST.md` | Owner env/auth prep |
| `STACKED_RELEASE_SMOKE_TEST.md` | Pre/post deploy smoke |
| `STACKED_RELEASE_ROLLBACK.md` | Incident rollback |
| `FOUNDATION_PRODUCTION_RUNBOOK.md` | Deploy procedure |
| `SECURITY_REVIEW.md` | Security audit |
| `FLORISYN_REPOSITORY_AUDIT.md` | Codebase inventory |

---

## Quick start for agents

1. Read **this governance map** (you are here).
2. Read **Master Architecture Bible** §1–§3 for tenant model and services.
3. Read **Gold Standard** before any architecture or data-model change.
4. Read **Experience Standard** + **Design System** before any UI work.
5. Declare **portal ownership** (Ecosystem Portals) in PR descriptions.
6. Update **Master Build Checklist** when shipping.

---

*Florisyn Governance Map — documentation entry point. Added 2026-07-30.*
