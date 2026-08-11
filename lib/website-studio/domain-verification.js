/**
 * Custom domain DNS verification for published florist websites.
 */

export function normalizeDomain(input = "") {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export function florisynCnameTarget(env = process.env) {
  const raw = String(env.FLORISYN_STORE_CNAME || env.SITE_URL || "https://www.florisyn.com")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (raw.startsWith("sites.")) return raw;
  const bare = raw.replace(/^www\./, "");
  return `sites.${bare}`;
}

export function buildDnsInstructions(domain, shop = {}, env = process.env) {
  const host = normalizeDomain(domain);
  const target = florisynCnameTarget(env);
  const slug = shop.slug || "your-shop";
  return {
    domain: host,
    records: [
      {
        type: "CNAME",
        host: host.startsWith("www.") ? "www" : "@",
        name: host,
        value: target,
        ttl: 3600
      },
      {
        type: "CNAME",
        host: "www",
        name: `www.${host.replace(/^www\./, "")}`,
        value: target,
        ttl: 3600,
        optional: true
      }
    ],
    fallback_url: `${String(env.SITE_URL || "https://www.florisyn.com").replace(/\/$/, "")}/store/${slug}`,
    steps: [
      `Sign in to your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.).`,
      `Add a CNAME record pointing ${host} to ${target}.`,
      `Wait up to 48 hours for DNS propagation (often minutes).`,
      `Click "Verify DNS" in Website Studio — Florisyn will check the record automatically.`,
      `After verification, your published site will use https://${host} as the canonical URL.`
    ]
  };
}

/**
 * Verify CNAME points to Florisyn. Injectable resolver for tests.
 */
export async function verifyDomainDns(domain, env = process.env, resolver = null) {
  const host = normalizeDomain(domain);
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    return { verified: false, error: "Enter a valid domain like flowershop.com or www.flowershop.com." };
  }
  const expected = florisynCnameTarget(env).toLowerCase();
  const dns = resolver || (await import("node:dns/promises")).default;

  try {
    let records = [];
    try {
      records = await dns.resolveCname(host);
    } catch (e) {
      if (e.code === "ENODATA" || e.code === "ENOTFOUND") {
        try {
          const cname = await dns.resolve(host, "CNAME");
          records = Array.isArray(cname) ? cname : [cname];
        } catch {
          return {
            verified: false,
            records: [],
            expected,
            error: "No CNAME record found yet. DNS changes can take up to 48 hours."
          };
        }
      } else {
        throw e;
      }
    }
    const normalized = records.map((r) => String(r).toLowerCase().replace(/\.$/, ""));
    const verified = normalized.some((r) => r === expected || r.endsWith(`.${expected}`) || expected.includes(r));
    return {
      verified,
      records: normalized,
      expected,
      error: verified ? null : `CNAME should point to ${expected}. Found: ${normalized.join(", ") || "none"}.`
    };
  } catch (e) {
    return { verified: false, error: e.message || "DNS lookup failed." };
  }
}

export function mergeDomainStatus(current = {}, verification = {}, domain) {
  return {
    ...current,
    host: domain,
    connected: !!verification.verified,
    status: verification.verified ? "connected" : "pending_verification",
    last_checked_at: new Date().toISOString(),
    cname_records: verification.records || [],
    expected_cname: verification.expected || null,
    ssl: verification.verified ? "pending_provision" : "pending"
  };
}
