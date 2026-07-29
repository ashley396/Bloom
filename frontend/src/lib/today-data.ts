export type DesignQueueItem = {
  id: string;
  title: string;
  customer: string;
  dueTime: string;
  status: "in-progress" | "waiting" | "ready";
  priority?: "rush" | "standard";
};

export type DeliveryStop = {
  id: string;
  time: string;
  recipient: string;
  address: string;
  status: "scheduled" | "en-route" | "delivered";
};

export type InventoryAlert = {
  id: string;
  item: string;
  detail: string;
  severity: "low" | "critical";
};

export type ActivityItem = {
  id: string;
  time: string;
  title: string;
  meta: string;
};

export const todayBriefing = {
  firstName: "Ashley",
  dateLabel: "Wednesday, July 29 · Lilies in Bloom",
  briefingLine:
    "You have 12 orders due today, 4 deliveries before noon, and 2 design benches open. Lily surfaced three ideas from your cooler inventory.",
  kpis: {
    orders: { value: "12", detail: "Due today", trend: "+3 vs yesterday" },
    revenue: { value: "$4,280", detail: "Projected", trend: "On pace for weekly goal" },
    deliveries: { value: "4", detail: "Before 2 PM", trend: "2 en route" },
    staff: { value: "5", detail: "On floor", trend: "All stations covered" },
  },
  lily: {
    headline: "Cooler-friendly spring palette",
    body: "White lisianthus and soft garden roses match 68% of today’s open orders. I drafted captions for two wedding pieces.",
    cta: "Open Lily Studio",
  },
};

export const designQueue: DesignQueueItem[] = [
  {
    id: "1",
    title: "Garden romance centerpiece",
    customer: "Chen · Wedding",
    dueTime: "10:30 AM",
    status: "in-progress",
    priority: "rush",
  },
  {
    id: "2",
    title: "Sympathy easel — ivory & sage",
    customer: "Martinez",
    dueTime: "11:00 AM",
    status: "waiting",
  },
  {
    id: "3",
    title: "Weekly office subscription",
    customer: "Northside Dental",
    dueTime: "12:30 PM",
    status: "in-progress",
  },
  {
    id: "4",
    title: "Birthday hat box",
    customer: "Walk-in queue",
    dueTime: "1:15 PM",
    status: "ready",
  },
];

export const deliveryTimeline: DeliveryStop[] = [
  {
    id: "d1",
    time: "9:15 AM",
    recipient: "Riverview Hospital",
    address: "1200 Maple Ave",
    status: "delivered",
  },
  {
    id: "d2",
    time: "10:45 AM",
    recipient: "Amelia Grant",
    address: "88 Oak Lane",
    status: "en-route",
  },
  {
    id: "d3",
    time: "12:00 PM",
    recipient: "Studio Eleven",
    address: "4th & Pine",
    status: "scheduled",
  },
  {
    id: "d4",
    time: "1:30 PM",
    recipient: "James Okonkwo",
    address: "19 Lakeview Dr",
    status: "scheduled",
  },
];

export const inventoryAlerts: InventoryAlert[] = [
  {
    id: "i1",
    item: "White lisianthus",
    detail: "18 stems · below par level",
    severity: "critical",
  },
  {
    id: "i2",
    item: "Israeli ruscus",
    detail: "Use first — oldest lot in cooler",
    severity: "low",
  },
  {
    id: "i3",
    item: "Sage ribbon #2",
    detail: "Reorder suggested this week",
    severity: "low",
  },
];

export const recentActivity: ActivityItem[] = [
  {
    id: "a1",
    time: "8:42 AM",
    title: "Cash payment recorded",
    meta: "Order #1042 · $186.00",
  },
  {
    id: "a2",
    time: "8:15 AM",
    title: "Delivery marked complete",
    meta: "Riverview Hospital",
  },
  {
    id: "a3",
    time: "7:50 AM",
    title: "Emma clocked in",
    meta: "Design bench 2",
  },
  {
    id: "a4",
    time: "7:30 AM",
    title: "Walk-in order created",
    meta: "Pickup · Today 1:15 PM",
  },
];

export const quickActions = [
  { id: "new-order", label: "New order", hint: "Walk-in or phone" },
  { id: "take-payment", label: "Take payment", hint: "Payment Center" },
  { id: "add-delivery", label: "Add delivery", hint: "Route board" },
  { id: "scan-inventory", label: "Receive stems", hint: "Inventory" },
] as const;
