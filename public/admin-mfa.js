/**
 * Admin-only Supabase MFA helpers.
 * Used exclusively by /admin login. Never imported by florist/POS/login pages.
 */

/** Pure gate decision for Admin MFA (testable without network). */
export function adminMfaGateDecision({ currentLevel, nextLevel, verifiedFactorCount = 0, pendingFactorCount = 0 } = {}) {
  if (currentLevel === "aal2") return { action: "allow", reason: "aal2" };
  if (verifiedFactorCount > 0 || nextLevel === "aal2") {
    return { action: "challenge", reason: "enrolled_pending_verify" };
  }
  if (pendingFactorCount > 0) {
    return { action: "challenge", reason: "pending_factor_exists" };
  }
  return { action: "enroll", reason: "admin_mfa_required" };
}

async function loadCreateClient() {
  const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm");
  return mod.createClient;
}

export async function createAdminMfaClient(supabaseUrl, anonKey) {
  if (!supabaseUrl || !anonKey) {
    throw new Error("Admin MFA client configuration is missing.");
  }
  const createClient = await loadCreateClient();
  return createClient(String(supabaseUrl).replace(/\/$/, ""), anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      }
    }
  });
}

export async function bindAdminSession(supabase, session) {
  if (!session?.accessToken || !session?.refreshToken) {
    throw new Error("Admin session is required for MFA.");
  }
  const { data, error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken
  });
  if (error) throw error;
  return data.session;
}

export async function readAdminMfaState(supabase) {
  const [{ data: aal, error: aalError }, { data: factors, error: factorError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors()
  ]);
  if (aalError) throw aalError;
  if (factorError) throw factorError;
  const totp = factors?.totp || [];
  const verified = totp.filter((f) => f.status === "verified");
  const pending = totp.filter((f) => f.status !== "verified");
  const decision = adminMfaGateDecision({
    currentLevel: aal?.currentLevel || null,
    nextLevel: aal?.nextLevel || null,
    verifiedFactorCount: verified.length,
    pendingFactorCount: pending.length
  });
  return {
    currentLevel: aal?.currentLevel || null,
    nextLevel: aal?.nextLevel || null,
    verifiedFactors: verified,
    pendingFactors: pending,
    decision
  };
}

/** Enroll Admin TOTP via supabase.auth.mfa.enroll(). Reuses an existing pending factor. */
export async function enrollAdminTotp(supabase, friendlyName = "Florisyn Admin") {
  const { data: listed, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw listError;
  const existing = (listed?.totp || []).find(
    (f) => String(f.friendly_name || f.friendlyName || "") === friendlyName
  );
  if (existing?.status === "verified") {
    return { factorId: existing.id, alreadyVerified: true, qrCode: "", secret: "", uri: "" };
  }
  if (existing) {
    return {
      factorId: existing.id,
      pendingVerification: true,
      qrCode: "",
      secret: "",
      uri: ""
    };
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp?.qr_code || "",
    secret: data.totp?.secret || "",
    uri: data.totp?.uri || ""
  };
}

/** Challenge + verify Admin MFA via supabase.auth.mfa.challenge/verify. */
export async function challengeAndVerifyAdminMfa(supabase, { factorId, code }) {
  const trimmed = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) {
    throw new Error("Enter the 6-digit authenticator code.");
  }
  if (!factorId) throw new Error("Missing MFA factor.");

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId
  });
  if (challengeError) throw challengeError;

  const { data, error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: trimmed
  });
  if (error) throw error;

  const accessToken = data?.access_token || data?.session?.access_token;
  const refreshToken = data?.refresh_token || data?.session?.refresh_token;
  const user = data?.user || data?.session?.user;
  if (!accessToken || !refreshToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session?.access_token) {
      throw new Error("MFA verified, but Admin session tokens were not returned.");
    }
    return {
      accessToken: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token,
      user: sessionData.session.user
    };
  }
  return { accessToken, refreshToken, user };
}

export async function pickAdminFactorId(supabase, preferredFactorId) {
  if (preferredFactorId) return preferredFactorId;
  const state = await readAdminMfaState(supabase);
  const id = state.verifiedFactors[0]?.id || state.pendingFactors[0]?.id;
  if (!id) throw new Error("No Admin MFA factor is enrolled.");
  return id;
}
