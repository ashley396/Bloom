/** Format a number as US dollars. */
export function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

/** Escape untrusted text before inserting it into an HTML string. */
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]);
}

/** Format a YYYY-MM-DD value without shifting it across time zones. */
export function dateText(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString() : "";
}
