/** Normalize phone to digits for duplicate comparison within a shop. */

export function normalizePhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Detect duplicate customer by email (exact) or phone (last 10 digits).
 * @returns {{ duplicate: boolean, field?: string, existing?: object }}
 */
export async function findDuplicateCustomer(client, shopId, { phone, email, excludeId = null }) {
  if (!shopId) return { duplicate: false };

  const emailNorm = normalizeEmail(email);
  if (emailNorm) {
    let query = client
      .from("customers")
      .select("id,name,email,phone")
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .ilike("email", emailNorm);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    if (data) return { duplicate: true, field: "email", existing: data };
  }

  const phoneDigits = normalizePhoneDigits(phone);
  if (phoneDigits.length >= 7) {
    const { data: rows, error } = await client
      .from("customers")
      .select("id,name,email,phone")
      .eq("shop_id", shopId)
      .is("deleted_at", null);
    if (error) throw error;
    const match = (rows || []).find((row) => {
      if (excludeId && row.id === excludeId) return false;
      const rowDigits = normalizePhoneDigits(row.phone);
      if (!rowDigits) return false;
      if (rowDigits === phoneDigits) return true;
      if (phoneDigits.length >= 10 && rowDigits.slice(-10) === phoneDigits.slice(-10)) return true;
      return false;
    });
    if (match) return { duplicate: true, field: "phone", existing: match };
  }

  return { duplicate: false };
}
