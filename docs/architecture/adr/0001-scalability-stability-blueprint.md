# ADR 0001: Scalability, Performance, and Stability Blueprint

- **Status:** Accepted
- **Date:** 2026-08-07
- **Deciders:** Florisyn Technical Direction (Closed Beta / August 21 launch program)

## Context

FLORISYN must remain secure and coherent under login bursts and daily florist traffic without claiming unproven capacity. Product priority is governed by `FLORISYN-BLUEPRINT-GOVERNANCE-MAP.md` and the Master Architecture Bible. Capacity work must strengthen those gates, not reorder product phases or activate deferred modules.

## Decision

Adopt `docs/architecture/FLORISYN-SCALABILITY-STABILITY-BLUEPRINT.md` as the binding nonfunctional architecture for:

- Netlify edge admission and auth rate limiting (P0-17 and successors);
- bounded upstream timeouts and calm Retry-After client handling;
- request correlation IDs on auth edges and sanitized operational logs;
- staged k6 load evidence before capacity claims;
- graceful degradation of nonessential services (AI, community, marketplace enrichment) while core florist workflows stay available.

## Consequences

- Release claims must match hosted evidence (not local intent).
- 10,000-session / enterprise capacity statements remain blocked until section F load gates pass.
- Wholesalers, Community, and advanced admin editing remain phase-gated regardless of capacity work.
- Implementation agents may complete checklist items that are code-fixable without production secret changes; production load tests and provider quota reviews remain separate approval gates.

## Links

- Blueprint: `docs/architecture/FLORISYN-SCALABILITY-STABILITY-BLUEPRINT.md`
- Governance map: `docs/architecture/FLORISYN-BLUEPRINT-GOVERNANCE-MAP.md`
- k6 suite: `load-tests/k6/florisyn-auth-capacity.js`
