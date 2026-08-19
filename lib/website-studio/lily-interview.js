/**
 * Lily Website Quick Start — florist interview steps → wizard_generate brief.
 */

export const LILY_INTERVIEW_STEPS = [
  {
    id: "welcome",
    title: "Welcome",
    lily: "Hi! I'm Lily. Let's build a florist website that feels like your shop — warm, trustworthy, and easy to order from.",
    fields: []
  },
  {
    id: "shop_story",
    title: "Your shop",
    lily: "Tell me about your flower shop in one sentence — what makes you special?",
    fields: [{ key: "specialty", label: "What you sell most", placeholder: "Everyday bouquets, weddings, sympathy, plants", type: "textarea" }]
  },
  {
    id: "customers",
    title: "Best customers",
    lily: "Who do you serve best? This helps me write copy that speaks to real buyers in your area.",
    fields: [
      { key: "audience", label: "Ideal customers", placeholder: "Busy families, brides, funeral homes, corporate clients" },
      { key: "delivery_area", label: "Delivery area", placeholder: "Austin, Round Rock, and nearby neighborhoods" }
    ]
  },
  {
    id: "style",
    title: "Look & feel",
    lily: "Pick a style that matches your brand. You can change themes anytime without losing your content.",
    fields: [
      {
        key: "style",
        label: "Website personality",
        type: "select",
        options: [
          "Classic luxury florist",
          "Garden cottage warmth",
          "Modern minimal",
          "Bright gift shop",
          "Wedding studio elegance",
          "Sympathy & memorial calm"
        ]
      },
      {
        key: "launch_mode",
        label: "Theme template",
        type: "select",
        options: [
          { value: "classic_florist", label: "Classic Florist" },
          { value: "luxury_boutique", label: "Luxury Boutique" },
          { value: "garden_cottage", label: "Garden & Cottage" },
          { value: "bright_gift", label: "Bright Gift Shop" },
          { value: "wedding_studio", label: "Wedding Studio" },
          { value: "sympathy_memorial", label: "Sympathy & Memorial" },
          { value: "modern_minimal", label: "Modern Minimal" },
          { value: "rustic_farmhouse", label: "Rustic Farmhouse" }
        ]
      }
    ]
  },
  {
    id: "occasions",
    title: "Occasions",
    lily: "Which occasions should we highlight on your homepage? Sympathy and everyday are must-haves for most florists.",
    fields: [
      { key: "occasions", label: "Occasions to feature", placeholder: "Birthday, Sympathy, Wedding, Anniversary, Plants" },
      { key: "hero_goal", label: "Main website goal", type: "textarea", placeholder: "Make ordering beautiful flowers fast, clear, and trustworthy" }
    ]
  },
  {
    id: "commerce",
    title: "Online orders",
    lily: "Almost there! Should customers pay online or call your shop? You can change this later.",
    fields: [
      { key: "online_pay", label: "Allow pay now (Stripe)", type: "checkbox", default: true },
      { key: "pay_later", label: "Allow pay later / phone orders", type: "checkbox", default: true }
    ]
  },
  {
    id: "review",
    title: "Review",
    lily: "Perfect. I'll generate a full draft with pages, sections, SEO basics, and starter catalog content. You approve everything before publish.",
    fields: []
  }
];

export function styleToLaunchMode(style = "") {
  const map = {
    "classic luxury florist": "luxury_boutique",
    "garden cottage warmth": "garden_cottage",
    "modern minimal": "modern_minimal",
    "bright gift shop": "bright_gift",
    "wedding studio elegance": "wedding_studio",
    "sympathy & memorial calm": "sympathy_memorial"
  };
  return map[String(style).toLowerCase()] || "classic_florist";
}

export function buildBriefFromInterview(answers = {}) {
  return {
    style: answers.style || "classic luxury florist",
    audience: answers.audience || "local flower buyers",
    specialty: answers.specialty || "fresh flowers and gifts",
    delivery_area: answers.delivery_area || "",
    hero_goal: answers.hero_goal || "Make ordering flowers feel simple, elegant, and trustworthy.",
    occasions: answers.occasions || "Birthday, Sympathy, Wedding, Plants"
  };
}

export function buildWizardPayload(answers = {}) {
  const launch_mode = answers.launch_mode || styleToLaunchMode(answers.style);
  return {
    launch_mode,
    brief: buildBriefFromInterview(answers),
    seed_catalog: true,
    commerce_settings: {
      online_ordering_enabled: true,
      stripe_checkout_enabled: answers.online_pay !== false,
      pay_later_enabled: answers.pay_later !== false,
      deposit_percent: 0,
      delivery_lead_days: 0
    }
  };
}

export function interviewProgress(stepIndex, total = LILY_INTERVIEW_STEPS.length) {
  return Math.round(((stepIndex + 1) / total) * 100);
}
