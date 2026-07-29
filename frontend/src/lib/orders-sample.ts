import type { FloralAssetId } from "./floral-asset-library";
import {
  getOrdersListPhotoId,
  type OrdersPhotoSlotId,
} from "./floral-asset-library";

export type OrderStatus =
  | "pending"
  | "designing"
  | "ready"
  | "out-for-delivery"
  | "delivered"
  | "cancelled";

export type OrderFilterChip =
  | "today"
  | "tomorrow"
  | "funeral"
  | "wedding"
  | "birthday"
  | "anniversary"
  | "hospital"
  | "pending"
  | "delivered";

export type StemLine = {
  flower: string;
  count: number;
  substitution?: string;
};

export type DesignerChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

export type DeliveryProof = {
  signedBy?: string;
  photoNote?: string;
  deliveredAt?: string;
};

export type FloristOrder = {
  id: string;
  orderNumber: string;
  customer: string;
  customerPhone: string;
  recipient: string;
  occasion: string;
  occasionTags: OrderFilterChip[];
  deliveryDate: string;
  deliveryTime: string;
  price: string;
  status: OrderStatus;
  designer: string;
  driver: string;
  photoId: FloralAssetId;
  photoSlot: Exclude<OrdersPhotoSlotId, "orders.detail.hero">;
  recipeName: string;
  stems: StemLine[];
  ribbonColor: string;
  cardMessage: string;
  deliveryAddress: string;
  customerNotes: string;
  paymentStatus: "paid" | "deposit" | "unpaid" | "invoiced";
  designerNotes: string;
  checklist: DesignerChecklistItem[];
  routeSummary: string;
  eta: string;
  deliveryNotes: string;
  deliveryProof: DeliveryProof;
};

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "Pending",
  designing: "Designing",
  ready: "Ready",
  "out-for-delivery": "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const ordersSample: FloristOrder[] = [
  {
    id: "ord-101",
    orderNumber: "10482",
    customer: "Michael Torres",
    customerPhone: "(512) 555-0142",
    recipient: "Johnson Family",
    occasion: "Sympathy",
    occasionTags: ["today", "funeral", "pending"],
    deliveryDate: "Jul 29, 2026",
    deliveryTime: "10:00 AM",
    price: "$185.00",
    status: "designing",
    designer: "Ashley",
    driver: "Marcus",
    photoId: getOrdersListPhotoId("orders.list.ord-101"),
    photoSlot: "orders.list.ord-101",
    recipeName: "Peaceful Garden",
    stems: [
      { flower: "White lilies", count: 5 },
      { flower: "Stock", count: 8 },
      { flower: "Leatherleaf", count: 6 },
    ],
    ribbonColor: "Ivory satin",
    cardMessage: "With deepest sympathy — The Torres Family",
    deliveryAddress: "Johnson Funeral Home, 420 Elm St",
    customerNotes: "Please use the side entrance.",
    paymentStatus: "paid",
    designerNotes: "Soft, open garden shape — no bright colors.",
    checklist: [
      { id: "c1", label: "Hydrate lilies", done: true },
      { id: "c2", label: "Attach card", done: false },
      { id: "c3", label: "Quality photo", done: false },
    ],
    routeSummary: "Downtown · 4.2 mi",
    eta: "9:45 AM",
    deliveryNotes: "Deliver to chapel attendant.",
    deliveryProof: {},
  },
  {
    id: "ord-102",
    orderNumber: "10479",
    customer: "Riverview Hospital",
    customerPhone: "(512) 555-0199",
    recipient: "Patient Room 412 — Ms. Chen",
    occasion: "Get well",
    occasionTags: ["today", "hospital"],
    deliveryDate: "Jul 29, 2026",
    deliveryTime: "11:30 AM",
    price: "$92.00",
    status: "ready",
    designer: "Elena",
    driver: "Elena",
    photoId: getOrdersListPhotoId("orders.list.ord-102"),
    photoSlot: "orders.list.ord-102",
    recipeName: "Sunlit Posy",
    stems: [
      { flower: "Gerbera", count: 6 },
      { flower: "Alstroemeria", count: 5 },
    ],
    ribbonColor: "Sage grosgrain",
    cardMessage: "Wishing you a gentle recovery.",
    deliveryAddress: "Riverview Hospital, 880 Medical Pkwy",
    customerNotes: "No latex balloons in room.",
    paymentStatus: "invoiced",
    designerNotes: "Keep compact for bedside table.",
    checklist: [
      { id: "c1", label: "Hydrate", done: true },
      { id: "c2", label: "Attach card", done: true },
      { id: "c3", label: "Quality photo", done: true },
    ],
    routeSummary: "North · 6.1 mi",
    eta: "11:15 AM",
    deliveryNotes: "Check in at front desk.",
    deliveryProof: {},
  },
  {
    id: "ord-103",
    orderNumber: "10475",
    customer: "Studio Eleven Events",
    customerPhone: "(512) 555-0333",
    recipient: "The Whitfield Wedding",
    occasion: "Wedding",
    occasionTags: ["tomorrow", "wedding"],
    deliveryDate: "Jul 30, 2026",
    deliveryTime: "8:00 AM",
    price: "$340.00",
    status: "pending",
    designer: "Ashley",
    driver: "Marcus",
    photoId: getOrdersListPhotoId("orders.list.ord-103"),
    photoSlot: "orders.list.ord-103",
    recipeName: "Bridal Cascade",
    stems: [
      { flower: "Garden roses", count: 12 },
      { flower: "Ranunculus", count: 8 },
      { flower: "Italian ruscus", count: 10 },
    ],
    ribbonColor: "Blush silk",
    cardMessage: "",
    deliveryAddress: "Whitfield Estate, 12 Vineyard Ln",
    customerNotes: "Match swatch #BL-02 from planner.",
    paymentStatus: "deposit",
    designerNotes: "Loose romantic cascade — bride prefers asymmetry.",
    checklist: [
      { id: "c1", label: "Confirm swatch", done: false },
      { id: "c2", label: "Stem prep", done: false },
    ],
    routeSummary: "Hill Country · 18 mi",
    eta: "7:30 AM",
    deliveryNotes: "Venue coordinator: Jamie.",
    deliveryProof: {},
  },
  {
    id: "ord-104",
    orderNumber: "10471",
    customer: "Daniel Reeves",
    customerPhone: "(512) 555-0210",
    recipient: "Amelia Grant",
    occasion: "Anniversary",
    occasionTags: ["today", "anniversary"],
    deliveryDate: "Jul 29, 2026",
    deliveryTime: "12:15 PM",
    price: "$128.00",
    status: "designing",
    designer: "Elena",
    driver: "Marcus",
    photoId: getOrdersListPhotoId("orders.list.ord-104"),
    photoSlot: "orders.list.ord-104",
    recipeName: "Classic Romance",
    stems: [
      { flower: "Red roses", count: 12 },
      { flower: "Eucalyptus", count: 4 },
    ],
    ribbonColor: "Burgundy velvet",
    cardMessage: "Twelve years — still my favorite.",
    deliveryAddress: "88 Oak Lane",
    customerNotes: "Ring doorbell — surprise delivery.",
    paymentStatus: "paid",
    designerNotes: "Tight spiral, premium rose grade only.",
    checklist: [
      { id: "c1", label: "Rose QC", done: true },
      { id: "c2", label: "Attach card", done: false },
    ],
    routeSummary: "Oak Hills · 3.8 mi",
    eta: "12:05 PM",
    deliveryNotes: "Leave with concierge if no answer.",
    deliveryProof: {},
  },
  {
    id: "ord-105",
    orderNumber: "10468",
    customer: "Northside Dental",
    customerPhone: "(512) 555-0400",
    recipient: "Front desk",
    occasion: "Birthday",
    occasionTags: ["today", "birthday"],
    deliveryDate: "Jul 29, 2026",
    deliveryTime: "2:00 PM",
    price: "$76.00",
    status: "ready",
    designer: "Ashley",
    driver: "Elena",
    photoId: getOrdersListPhotoId("orders.list.ord-105"),
    photoSlot: "orders.list.ord-105",
    recipeName: "Pastel Celebration",
    stems: [
      { flower: "Pastel roses", count: 6 },
      { flower: "Carnations", count: 6 },
    ],
    ribbonColor: "Blush organza",
    cardMessage: "Happy Birthday, Dr. Patel!",
    deliveryAddress: "Northside Dental, 901 Congress Ave",
    customerNotes: "Weekly standing order — brand vase.",
    paymentStatus: "invoiced",
    designerNotes: "Use shop ceramic vase #3.",
    checklist: [
      { id: "c1", label: "Vase polished", done: true },
      { id: "c2", label: "Attach card", done: true },
    ],
    routeSummary: "Central · 2.1 mi",
    eta: "1:50 PM",
    deliveryNotes: "Reception knows us.",
    deliveryProof: {},
  },
  {
    id: "ord-106",
    orderNumber: "10465",
    customer: "Harborview Corporate",
    customerPhone: "(512) 555-0505",
    recipient: "Lobby — Suite 200",
    occasion: "Corporate",
    occasionTags: ["tomorrow"],
    deliveryDate: "Jul 30, 2026",
    deliveryTime: "9:00 AM",
    price: "$210.00",
    status: "pending",
    designer: "Elena",
    driver: "Marcus",
    photoId: getOrdersListPhotoId("orders.list.ord-106"),
    photoSlot: "orders.list.ord-106",
    recipeName: "Executive Centerpiece",
    stems: [
      { flower: "Hydrangea", count: 4 },
      { flower: "Rose", count: 8 },
    ],
    ribbonColor: "None",
    cardMessage: "",
    deliveryAddress: "Harborview Tower, 200 Congress",
    customerNotes: "Low profile for reception desk.",
    paymentStatus: "unpaid",
    designerNotes: "Foam low bowl, symmetrical.",
    checklist: [{ id: "c1", label: "Measure bowl", done: false }],
    routeSummary: "Central · 2.4 mi",
    eta: "8:50 AM",
    deliveryNotes: "Loading dock before 10 AM.",
    deliveryProof: {},
  },
  {
    id: "ord-107",
    orderNumber: "10460",
    customer: "Sarah Kim",
    customerPhone: "(512) 555-0612",
    recipient: "Sarah Kim (self)",
    occasion: "Everyday",
    occasionTags: ["today"],
    deliveryDate: "Jul 29, 2026",
    deliveryTime: "4:30 PM",
    price: "$64.00",
    status: "out-for-delivery",
    designer: "Ashley",
    driver: "Elena",
    photoId: getOrdersListPhotoId("orders.list.ord-107"),
    photoSlot: "orders.list.ord-107",
    recipeName: "Market Mix",
    stems: [
      { flower: "Seasonal mix", count: 15 },
      { flower: "Solidago", count: 3 },
    ],
    ribbonColor: "Kraft twine",
    cardMessage: "You deserve fresh flowers today.",
    deliveryAddress: "15 Lakeview Dr, Apt 2B",
    customerNotes: "Text when arriving.",
    paymentStatus: "paid",
    designerNotes: "Farmer's market feel — airy.",
    checklist: [
      { id: "c1", label: "Hydrate", done: true },
      { id: "c2", label: "Attach card", done: true },
      { id: "c3", label: "Quality photo", done: true },
    ],
    routeSummary: "Lakeside · 5.0 mi",
    eta: "4:20 PM",
    deliveryNotes: "Gate code 2210.",
    deliveryProof: { photoNote: "Left with doorman" },
  },
  {
    id: "ord-108",
    orderNumber: "10455",
    customer: "Grace Memorial",
    customerPhone: "(512) 555-0700",
    recipient: "Memorial Service — Hall B",
    occasion: "Funeral",
    occasionTags: ["tomorrow", "funeral"],
    deliveryDate: "Jul 30, 2026",
    deliveryTime: "1:00 PM",
    price: "$245.00",
    status: "pending",
    designer: "Ashley",
    driver: "Marcus",
    photoId: getOrdersListPhotoId("orders.list.ord-108"),
    photoSlot: "orders.list.ord-108",
    recipeName: "Blue Hydrangea Tribute",
    stems: [
      { flower: "Hydrangea", count: 8 },
      { flower: "White roses", count: 6 },
    ],
    ribbonColor: "Ivory",
    cardMessage: "In loving memory of Robert Grace",
    deliveryAddress: "Grace Memorial Chapel, 300 Peaceful Way",
    customerNotes: "Stand included — deliver early for setup.",
    paymentStatus: "paid",
    designerNotes: "Cool tones only.",
    checklist: [{ id: "c1", label: "Stand test", done: false }],
    routeSummary: "East · 7.3 mi",
    eta: "12:30 PM",
    deliveryNotes: "Coordinator: Linda.",
    deliveryProof: {},
  },
  {
    id: "ord-109",
    orderNumber: "10450",
    customer: "James & Olivia Park",
    customerPhone: "(512) 555-0818",
    recipient: "Olivia Park",
    occasion: "Birthday",
    occasionTags: ["tomorrow", "birthday"],
    deliveryDate: "Jul 30, 2026",
    deliveryTime: "10:30 AM",
    price: "$98.00",
    status: "delivered",
    designer: "Elena",
    driver: "Elena",
    photoId: getOrdersListPhotoId("orders.list.ord-109"),
    photoSlot: "orders.list.ord-109",
    recipeName: "Spring Tulip Bowl",
    stems: [{ flower: "Tulip", count: 18 }],
    ribbonColor: "Butter yellow",
    cardMessage: "Happy 40th, Liv!",
    deliveryAddress: "44 Magnolia Ct",
    customerNotes: "",
    paymentStatus: "paid",
    designerNotes: "",
    checklist: [
      { id: "c1", label: "Hydrate", done: true },
      { id: "c2", label: "Attach card", done: true },
      { id: "c3", label: "Quality photo", done: true },
    ],
    routeSummary: "South · 4.5 mi",
    eta: "—",
    deliveryNotes: "Delivered to porch.",
    deliveryProof: {
      signedBy: "O. Park",
      deliveredAt: "Jul 28, 10:22 AM",
    },
  },
  {
    id: "ord-110",
    orderNumber: "10444",
    customer: "The Laurent Hotel",
    customerPhone: "(512) 555-0900",
    recipient: "Suite 1204 — Guest",
    occasion: "Anniversary",
    occasionTags: ["anniversary"],
    deliveryDate: "Jul 29, 2026",
    deliveryTime: "6:00 PM",
    price: "$156.00",
    status: "cancelled",
    designer: "—",
    driver: "—",
    photoId: getOrdersListPhotoId("orders.list.ord-110"),
    photoSlot: "orders.list.ord-110",
    recipeName: "Orchid Elegance",
    stems: [{ flower: "Phalaenopsis orchid", count: 2 }],
    ribbonColor: "Champagne",
    cardMessage: "Congratulations on your anniversary.",
    deliveryAddress: "Laurent Hotel, 600 Rio Grande",
    customerNotes: "Cancelled by guest — refund issued.",
    paymentStatus: "paid",
    designerNotes: "",
    checklist: [],
    routeSummary: "—",
    eta: "—",
    deliveryNotes: "",
    deliveryProof: {},
  },
];

export const orderFilterLabels: Record<OrderFilterChip, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  funeral: "Funeral",
  wedding: "Wedding",
  birthday: "Birthday",
  anniversary: "Anniversary",
  hospital: "Hospital",
  pending: "Pending",
  delivered: "Delivered",
};
