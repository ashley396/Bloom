/** Typed sample data for /today — replace with API wiring later. */

import {
  FLORISTRY_PHOTOS,
  TODAY_PAGE_PHOTOS,
} from "./floristry-photos";

export type TodaySummaryMetrics = {
  ordersToday: number;
  deliveries: number;
  revenue: string;
  staffClockedIn: number;
};

export type UpNextOrder = {
  customer: string;
  title: string;
  dueTime: string;
  deliveryNote: string;
  photoSrc?: string | null;
  photoFallbackSrc?: string | null;
};

export type DesignQueueOrder = {
  id: string;
  customerOrRecipient: string;
  occasion: string;
  dueTime: string;
  status: "designing" | "waiting" | "ready" | "delivered";
  price: string;
  photoSrc?: string | null;
  photoFallbackSrc?: string | null;
};

export type DeliveryScheduleStop = {
  id: string;
  time: string;
  destination: string;
  driver: string;
  status: "scheduled" | "en-route" | "delivered";
};

export type InventoryAlertRow = {
  id: string;
  item: string;
  level: "Low" | "Good" | "Reorder soon";
  quantity: string;
  photoSrc?: string | null;
  photoFallbackSrc?: string | null;
};

export type QuickActionId =
  | "new-order"
  | "open-pos"
  | "add-customer"
  | "receive-inventory"
  | "create-invoice";

export type BusinessSnapshotMetrics = {
  revenueGoalPercent: number;
  revenueGoalLabel: string;
  averageOrderValue: string;
  outstandingInvoices: string;
  deliveryProfitability: string;
};

export const todayPageData = {
  user: {
    firstName: "Ashley",
    shopName: "Lilies in Bloom",
  },
  dateLabel: "Wednesday, July 29, 2026",
  heroPhoto: {
    src: TODAY_PAGE_PHOTOS.hero.src,
    fallbackSrc: FLORISTRY_PHOTOS.seasonalSpring.src,
  },
  metrics: {
    ordersToday: 14,
    deliveries: 5,
    revenue: "$1,284",
    staffClockedIn: 3,
  } satisfies TodaySummaryMetrics,
  upNext: {
    customer: "Johnson Family",
    title: "Sympathy arrangement",
    dueTime: "10:00 AM",
    deliveryNote: "Delivery to Johnson Funeral Home",
    photoSrc: TODAY_PAGE_PHOTOS.upNext.src,
    photoFallbackSrc: FLORISTRY_PHOTOS.everydayMixed.src,
  } satisfies UpNextOrder,
  designQueue: [
    {
      id: "dq-1",
      customerOrRecipient: "Johnson Family",
      occasion: "Sympathy",
      dueTime: "10:00 AM",
      status: "designing",
      price: "$185.00",
      photoSrc: TODAY_PAGE_PHOTOS.designQueue["dq-1"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.rosesRed.src,
    },
    {
      id: "dq-2",
      customerOrRecipient: "Northside Dental",
      occasion: "Weekly subscription",
      dueTime: "11:30 AM",
      status: "waiting",
      price: "$92.00",
      photoSrc: TODAY_PAGE_PHOTOS.designQueue["dq-2"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.tulipsSpring.src,
    },
    {
      id: "dq-3",
      customerOrRecipient: "Amelia Grant",
      occasion: "Birthday",
      dueTime: "12:15 PM",
      status: "ready",
      price: "$128.00",
      photoSrc: TODAY_PAGE_PHOTOS.designQueue["dq-3"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.orchidElegant.src,
    },
    {
      id: "dq-4",
      customerOrRecipient: "Studio Eleven Events",
      occasion: "Corporate",
      dueTime: "2:00 PM",
      status: "waiting",
      price: "$340.00",
      photoSrc: TODAY_PAGE_PHOTOS.designQueue["dq-4"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.sunflowers.src,
    },
  ] satisfies DesignQueueOrder[],
  deliverySchedule: [
    {
      id: "ds-1",
      time: "9:30 AM",
      destination: "Johnson Funeral Home",
      driver: "Marcus",
      status: "en-route",
    },
    {
      id: "ds-2",
      time: "11:00 AM",
      destination: "Amelia Grant · 88 Oak Lane",
      driver: "Marcus",
      status: "scheduled",
    },
    {
      id: "ds-3",
      time: "12:45 PM",
      destination: "Northside Dental",
      driver: "Elena",
      status: "scheduled",
    },
    {
      id: "ds-4",
      time: "3:15 PM",
      destination: "Studio Eleven · 4th & Pine",
      driver: "Elena",
      status: "scheduled",
    },
    {
      id: "ds-5",
      time: "4:30 PM",
      destination: "Riverview Hospital",
      driver: "Marcus",
      status: "scheduled",
    },
  ] satisfies DeliveryScheduleStop[],
  lily: {
    message:
      "You're down to 18 white roses. Based on upcoming orders, I recommend adding one case to tomorrow's purchase order.",
    primaryAction: "Review Purchase Order",
    dismissAction: "Dismiss",
  },
  inventoryAlerts: [
    {
      id: "inv-1",
      item: "White Roses",
      level: "Low",
      quantity: "18 stems",
      photoSrc: TODAY_PAGE_PHOTOS.inventory["inv-1"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.weddingFlowers.src,
    },
    {
      id: "inv-2",
      item: "Hydrangeas",
      level: "Good",
      quantity: "42 stems",
      photoSrc: TODAY_PAGE_PHOTOS.inventory["inv-2"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.gardenHarmony.src,
    },
    {
      id: "inv-3",
      item: "Leatherleaf",
      level: "Reorder soon",
      quantity: "24 stems",
      photoSrc: TODAY_PAGE_PHOTOS.inventory["inv-3"].src,
      photoFallbackSrc: FLORISTRY_PHOTOS.seasonalSpring.src,
    },
  ] satisfies InventoryAlertRow[],
  quickActions: [
    { id: "new-order" as const, label: "New Order" },
    { id: "open-pos" as const, label: "Open POS" },
    { id: "add-customer" as const, label: "Add Customer" },
    { id: "receive-inventory" as const, label: "Receive Inventory" },
    { id: "create-invoice" as const, label: "Create Invoice" },
  ],
  businessSnapshot: {
    revenueGoalPercent: 72,
    revenueGoalLabel: "$1,284 of $1,780 daily goal",
    averageOrderValue: "$142",
    outstandingInvoices: "$2,460",
    deliveryProfitability: "34% margin",
  } satisfies BusinessSnapshotMetrics,
  dailyInsight:
    "Friday is expected to be busier than usual. Consider scheduling an additional delivery driver.",
};

export const designQueueStatusLabel: Record<
  DesignQueueOrder["status"],
  string
> = {
  designing: "Designing",
  waiting: "Waiting",
  ready: "Ready",
  delivered: "Delivered",
};

export const deliveryStatusLabel: Record<
  DeliveryScheduleStop["status"],
  string
> = {
  scheduled: "Scheduled",
  "en-route": "En route",
  delivered: "Delivered",
};

export const inventoryLevelTone: Record<
  InventoryAlertRow["level"],
  "critical" | "good" | "warn"
> = {
  Low: "critical",
  Good: "good",
  "Reorder soon": "warn",
};
