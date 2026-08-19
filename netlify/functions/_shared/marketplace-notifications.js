import { adminIfConfigured } from "./supabase.js";

const TABLE = "marketplace_notifications";
export const NOTIFICATION_TYPES = ["order_status_changed", "back_in_stock", "refund_requested"];

/**
 * Writes a real, already-happened marketplace event — never speculative,
 * never a reminder about something that might happen. Same pattern as
 * florist-community.js's notify(): a notification is always about
 * someone else's action, so it's written with the service-role client
 * (a buyer's own RLS-scoped client could never insert a row for another
 * user's recipient_user_id). Best-effort — a notification failing to
 * write must never block the real action (order status update, listing
 * save) it's attached to.
 */
export async function notifyMarketplaceUser(recipientUserId, type, message, { listingId = null, orderId = null } = {}) {
  if (!recipientUserId || !NOTIFICATION_TYPES.includes(type) || !message) return;
  const svc = adminIfConfigured();
  if (!svc) return;
  try {
    await svc.from(TABLE).insert({
      recipient_user_id: recipientUserId,
      type,
      listing_id: listingId,
      order_id: orderId,
      message
    });
  } catch (error) {
    console.error("Marketplace notification write failed:", error?.message || error);
  }
}

/**
 * Notifies every user who favorited a listing that just came back in
 * stock. Only ever called with real before/after availability already
 * computed by the caller — this function does not decide whether a
 * restock happened, only who to tell once it has.
 */
export async function notifyFavoritersBackInStock(client, listingId, message) {
  if (!listingId) return;
  const { data: favorites, error } = await client.from("marketplace_favorites").select("user_id").eq("listing_id", listingId);
  if (error || !favorites?.length) return;
  await Promise.all(
    favorites.map((row) => notifyMarketplaceUser(row.user_id, "back_in_stock", message, { listingId }))
  );
}
