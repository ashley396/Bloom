# Bloom Marketplace Account Design

Bloom should keep one secure authentication system and route users by account role.

## Roles

- `FLORIST`: browses approved suppliers, places orders, tracks shipments, and imports purchases into Bloom inventory.
- `WHOLESALER`: manages a supplier profile, products, availability, minimum quantities, delivery areas, incoming orders, and payouts.
- `PLATFORM_ADMIN`: approves wholesalers, manages disputes and marketplace settings, and reviews platform activity.

## Login and routing

All users may use the same sign-in page. After authentication, Bloom reads the user role and opens the correct workspace:

- Florist → Bloom shop dashboard
- Wholesaler → Wholesale Portal
- Platform admin → Bloom administration

Wholesalers should complete an application and remain `PENDING` until Bloom approves them. A wholesaler must never see a florist's private customers, payroll, or unrelated shop records.

## Wholesale Portal pages

1. Dashboard
2. Products and live availability
3. Incoming orders
4. Florist customers
5. Delivery and shipping settings
6. Payments and payouts
7. Sales reports
8. Supplier profile and verification

## Recommended database foundation

- `marketplace_profiles`
- `marketplace_memberships`
- `supplier_applications`
- `supplier_products`
- `supplier_inventory`
- `marketplace_orders`
- `marketplace_order_items`
- `supplier_delivery_zones`
- `supplier_payout_accounts`

Every table should use tenant-aware row-level security. Marketplace checkout and payouts should be added only after role isolation and supplier approval are tested.
