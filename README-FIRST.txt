BLOOM FLAGSHIP v6.0 — COMBINED MAJOR UPDATE

THIS RELEASE INCLUDES
• Multi-store creation and switching
• Product catalog and floral recipe costing
• Expanded florist order builder
• Website Studio with custom themes, colors, logo, hero image, domain and mobile preview
• Bloom Floral Library starter designs
• Delivery center
• Staff and role directory
• Wholesale marketplace listing and purchase-request foundation
• Customer CRM with VIP, birthday, anniversary and favorites
• Existing receipt uploads, Stripe checkout, receipts, expenses and profit reports

IMPORTANT LIMITS
• Full voice/generative AI still requires an external AI provider.
• Wholesale supplier payouts and commissions require Stripe Connect and marketplace compliance setup.
• Website Studio saves and previews the storefront. Publishing each florist to a separate custom domain needs the next public-storefront routing layer.
• The starter floral library uses editable floral artwork placeholders. Florists can paste their own product image URLs now.

INSTALL WITH ONE DEPLOYMENT
1. Unzip this package.
2. In Supabase SQL Editor, run only:
   supabase/migrations/v6.0.sql
3. Copy everything INSIDE Bloom_Flagship_v6 into the current Bloom repository.
4. Replace existing files.
5. In GitHub Desktop use:
   Upgrade Bloom to Flagship v6.0
6. Commit to main and Push origin once.
7. Wait for Netlify to finish, then hard-refresh and sign in.

TEST
• Create a product and recipe
• Add a Floral Library design to the catalog
• Save Website Studio settings
• Create an order from a product
• Add and advance a delivery
• Add staff and a wholesale listing
• Create a second store and switch between stores
