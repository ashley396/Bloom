(function (root, factory) {
  const api = factory();
  root.BloomMarketplaceExperience = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CART_KEY = 'bloom_marketplace_cart';

  function readCart() {
    try {
      return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  }

  function availabilityBadgeHtml(hooks, item) {
    if (!item.availability_status || item.availability_status === 'available_now') return '';
    const label = item.availability_label || item.availability_status.replace(/_/g, ' ');
    return `<span class="availability-badge status-${hooks.esc(item.availability_status)}">${hooks.esc(label)}</span>`;
  }

  function floralMetaHtml(hooks, item) {
    const bits = [item.variety, item.color, item.stem_length_in ? `${item.stem_length_in}" stems` : '', item.grower_name].filter(Boolean);
    return bits.length ? `<p class="marketplace-floral-meta">${bits.map((b) => hooks.esc(b)).join(' · ')}</p>` : '';
  }

  function specSheetHtml(hooks, item) {
    const rows = [
      ['Variety', item.variety],
      ['Color', item.color],
      ['Grade', item.grade],
      ['Stem length', item.stem_length_in ? `${item.stem_length_in}"` : ''],
      ['Grower', item.grower_name],
      ['Origin', item.origin],
      ['Stems per bunch', item.stems_per_bunch],
      ['Bunches per box', item.bunches_per_box],
      ['Case quantity', item.case_quantity],
      ['Lead time', item.lead_time_days ? `${item.lead_time_days} day(s)` : ''],
      ['Delivery region', item.delivery_region],
      ['Pickup', [item.pickup_city, item.pickup_state].filter(Boolean).join(', ')],
      ['Substitutions', item.substitution_note]
    ].filter(([, value]) => value !== null && value !== undefined && value !== '');
    if (!rows.length && !(item.unit_prices || []).length) return '';
    const priceRows = (item.unit_prices || [])
      .map((p) => `<div><dt>Price / ${hooks.esc(p.unit)}</dt><dd>${hooks.money(p.price)}</dd></div>`)
      .join('');
    return `<dl class="marketplace-spec-sheet">${priceRows}${rows.map(([label, value]) => `<div><dt>${hooks.esc(label)}</dt><dd>${hooks.esc(String(value))}</dd></div>`).join('')}</dl>`;
  }

  function cardDisplayPrice(hooks, item) {
    const price = item.display_price ?? item.price;
    const unit = item.display_price_unit || item.unit || 'each';
    return `${hooks.money(price)} / ${hooks.esc(unit)}`;
  }

  function productCard(item, hooks, options = {}) {
    const verifiedBadge = item.verified_seller || options.verifiedSeller
      ? '<span class="badge verified">Verified seller</span>'
      : '';
    const lowStock = item.low_stock ? '<span class="badge warn">Low stock</span>' : '';
    const favoriteClass = item.favorited ? ' active' : '';
    const urls = root.BloomLaunchPolish?.parseProductImages?.({ image_url: item.image_url, gallery_urls: item.gallery_urls, images: item.images }) || (item.image_url ? [item.image_url] : []);
    const media = urls.length && root.BloomLaunchPolish?.productGalleryThumbHtml
      ? root.BloomLaunchPolish.productGalleryThumbHtml(urls, item.product_name)
      : item.image_url
        ? `<img src="${hooks.esc(item.image_url)}" alt="" loading="lazy" decoding="async">`
        : '<div class="product-art">🌿</div>';
    return `<article class="product-card marketplace-product" data-listing-id="${hooks.esc(item.id)}">
      ${media}
      <div class="body">
        <div class="marketplace-card-badges">${verifiedBadge}<span class="badge">${hooks.esc(item.category || 'Marketplace')}</span>${lowStock}${availabilityBadgeHtml(hooks, item)}</div>
        <h3>${hooks.esc(item.product_name)}</h3>
        <p class="subtle">${hooks.esc(item.supplier_name || 'Seller')}</p>
        ${floralMetaHtml(hooks, item)}
        <div class="price">${cardDisplayPrice(hooks, item)}</div>
        <p class="meta">Min ${item.minimum_quantity || 1}${item.allows_local_pickup ? ' · Pickup' : ''}${item.allows_shipping === false ? '' : ' · Ships'}</p>
        <div class="card-actions marketplace-card-actions">
          <button type="button" class="secondary" data-market-detail="${hooks.esc(item.id)}">Details</button>
          <button type="button" class="secondary${favoriteClass}" data-market-favorite="${hooks.esc(item.id)}" aria-pressed="${item.favorited ? 'true' : 'false'}">Save</button>
          <button type="button" class="secondary" data-market-cart="${hooks.esc(item.id)}">Add to cart</button>
          <button type="button" class="primary wide" data-market-checkout="${hooks.esc(item.id)}">Checkout</button>
        </div>
      </div>
    </article>`;
  }

  async function loadBrowse(hooks, state) {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.seller) params.set('seller', state.seller);
    if (state.minPrice) params.set('minPrice', state.minPrice);
    if (state.maxPrice) params.set('maxPrice', state.maxPrice);
    if (state.inStock) params.set('inStock', 'true');
    if (state.shipping) params.set('shipping', state.shipping);
    if (state.variety) params.set('variety', state.variety);
    if (state.color) params.set('color', state.color);
    if (state.availability) params.set('availability', state.availability);
    if (state.byDate) params.set('byDate', state.byDate);
    const path = `marketplace-catalog${params.toString() ? `?${params}` : ''}`;
    let data;
    try {
      data = await hooks.api(path);
    } catch (error) {
      const fallback = await hooks.api('marketplace');
      data = { items: (fallback.items || []).map((row) => ({
        ...row,
        category: row.category || 'Fresh Flowers',
        allows_shipping: true,
        allows_local_pickup: false
      })) };
    }
    state.items = data.items || [];
    state.compare = data.compare || [];
    renderBrowse(hooks, state);
  }

  /**
   * "MULTIPLE WHOLESALERS" from the marketplace vision: when a search
   * matches the same variety from more than one seller, show a real
   * side-by-side comparison instead of making the florist scan a flat
   * grid to notice it themselves. Only real matched listings — never a
   * fabricated comparison.
   */
  function compareSectionHtml(hooks, groups) {
    if (!groups.length) return '';
    return groups.map((group) => `
      <section class="marketplace-compare-group">
        <h3>${hooks.esc(group.label)} — ${group.seller_count} sellers</h3>
        <div class="marketplace-compare-rows">
          ${group.items.map((item) => `
            <div class="marketplace-compare-row" data-market-detail="${hooks.esc(item.id)}">
              <span class="marketplace-compare-seller">${hooks.esc(item.supplier_name || 'Seller')}</span>
              <span class="marketplace-compare-price">${cardDisplayPrice(hooks, item)}</span>
              <span class="marketplace-compare-meta">${item.allows_local_pickup ? 'Pickup' : ''}${item.allows_local_pickup && item.allows_shipping !== false ? ' · ' : ''}${item.allows_shipping !== false ? 'Ships' : ''}</span>
              ${availabilityBadgeHtml(hooks, item)}
            </div>`).join('')}
        </div>
      </section>`).join('');
  }

  function renderBrowse(hooks, state) {
    const grid = hooks.$('#marketplaceBrowseGrid');
    const empty = hooks.$('#marketplaceBrowseEmpty');
    const compareSection = hooks.$('#marketplaceCompareSection');
    if (compareSection) compareSection.innerHTML = compareSectionHtml(hooks, state.compare || []);
    if (!grid) return;
    if (!state.items.length) {
      grid.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = state.items.map((item) => productCard(item, hooks)).join('');
  }

  async function openDetail(hooks, state, listingId) {
    const panel = hooks.$('#marketplaceDetailPanel');
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = '<p class="subtle">Loading product…</p>';
    try {
      const data = await hooks.api(`marketplace-catalog?listingId=${encodeURIComponent(listingId)}`);
      const item = data.listing;
      if (!item) throw new Error('Product not found.');
      const related = (data.related || []).map((r) => productCard(r, hooks, { verifiedSeller: data.verified_seller })).join('');
      const urls = root.BloomLaunchPolish?.parseProductImages?.({ image_url: item.image_url, gallery_urls: item.gallery_urls, images: item.images }) || (item.image_url ? [item.image_url] : []);
      const gallery = urls.length && root.BloomLaunchPolish?.productGalleryThumbHtml
        ? root.BloomLaunchPolish.productGalleryThumbHtml(urls, item.product_name)
        : item.image_url
          ? `<img class="marketplace-detail-image" src="${hooks.esc(item.image_url)}" alt="" loading="lazy">`
          : '';
      panel.innerHTML = `<div class="marketplace-detail">
        <button type="button" class="secondary" data-market-detail-close aria-label="Close product details">Close</button>
        ${gallery}
        <h2>${hooks.esc(item.product_name)}</h2>
        ${data.verified_seller ? '<span class="badge verified">Verified seller</span>' : ''}${availabilityBadgeHtml(hooks, item)}
        <p>${hooks.esc(item.description || 'No description yet.')}</p>
        <p class="price">${cardDisplayPrice(hooks, item)}</p>
        ${specSheetHtml(hooks, item)}
        <p class="subtle">Sold by ${hooks.esc(item.supplier_name || 'Seller')}</p>
        <div class="card-actions">
          <button type="button" class="primary" data-market-checkout="${hooks.esc(item.id)}">Checkout</button>
          <button type="button" class="secondary" data-market-storefront="${hooks.esc(item.shop_id)}">View seller</button>
        </div>
        <section><h3>Related products</h3><div class="product-grid compact">${related || hooks.empty('No related products yet.')}</div></section>
      </div>`;
    } catch (error) {
      panel.innerHTML = `<p class="subtle">${hooks.esc(error.message)}</p>`;
    }
  }

  const ORDER_STATUS_LABELS = {
    pending: 'Awaiting payment',
    processing: 'Processing',
    paid: 'Paid — not yet shipped',
    fulfilled: 'Fulfilled',
    completed: 'Completed',
    cancelled: 'Cancelled'
  };

  function orderCardHtml(hooks, order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemLines = items.map((i) => `${hooks.esc(i.name)} × ${i.quantity}${i.unit ? ` ${hooks.esc(i.unit)}` : ''}`).join(', ');
    const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
    const receiveAction = order.can_receive
      ? `<button type="button" class="primary" data-market-receive-order="${hooks.esc(order.id)}">Add to my inventory</button>`
      : (order.inventory_synced_at ? '<span class="badge good">Added to inventory</span>' : '');
    const reviewAction = order.can_review
      ? `<button type="button" class="secondary" data-market-review-order="${hooks.esc(order.id)}">Rate this order</button>`
      : '';
    const refundAction = order.can_request_refund
      ? `<button type="button" class="secondary" data-market-refund-order="${hooks.esc(order.id)}">Request refund</button>`
      : (order.refund_requested_at ? '<span class="badge warn">Refund requested</span>' : '');
    return `<article class="card marketplace-order-card">
      <div class="card-top">
        <div><h3>${hooks.esc(order.seller_display_name || 'Wholesale order')}</h3><p class="meta">${hooks.esc(statusLabel)} · ${hooks.esc((order.created_at || '').slice(0, 10))}</p></div>
        <strong>${hooks.money(order.total)}</strong>
      </div>
      <p class="subtle">${itemLines || 'No items on file.'}</p>
      <div class="card-actions">${receiveAction}<button type="button" class="secondary" data-market-reorder="${hooks.esc(order.id)}">Reorder</button>${reviewAction}${refundAction}</div>
      <form class="marketplace-review-form" data-market-review-form="${hooks.esc(order.id)}" hidden>
        <label>Overall rating<select name="rating" required><option value="">Choose…</option><option value="5">5 — Excellent</option><option value="4">4 — Good</option><option value="3">3 — Okay</option><option value="2">2 — Poor</option><option value="1">1 — Very poor</option></select></label>
        <div class="three"><label>Fulfillment<select name="fulfillment_rating"><option value="">—</option><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></label><label>Communication<select name="communication_rating"><option value="">—</option><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></label><label>Accurate descriptions<select name="accuracy_rating"><option value="">—</option><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></label></div>
        <label>Comment<textarea name="comment" rows="2" placeholder="Optional"></textarea></label>
        <button type="submit" class="primary">Submit review</button>
      </form>
      <form class="marketplace-refund-form" data-market-refund-form="${hooks.esc(order.id)}" hidden>
        <label>What's wrong with this order?<textarea name="reason" rows="2" required placeholder="e.g. flowers arrived damaged, wrong variety, order never arrived"></textarea></label>
        <p class="subtle">This notifies the seller — they process any refund from their own Stripe dashboard.</p>
        <button type="submit" class="primary">Send refund request</button>
      </form>
    </article>`;
  }

  async function loadMyOrders(hooks, state) {
    const mount = hooks.$('#marketplaceOrdersList');
    if (!mount) return;
    mount.innerHTML = '<p class="subtle">Loading your wholesale orders…</p>';
    try {
      const data = await hooks.api('marketplace-catalog?resource=my-orders');
      state.orders = data.orders || [];
      mount.innerHTML = state.orders.length
        ? state.orders.map((order) => orderCardHtml(hooks, order)).join('')
        : hooks.empty("You haven't purchased anything from the Wholesale Marketplace yet.");
    } catch (error) {
      mount.innerHTML = `<p class="subtle">${hooks.esc(error.message)}</p>`;
    }
    populateStandingOrderSellerOptions(hooks, state);
  }

  const CADENCE_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

  function populateStandingOrderSellerOptions(hooks, state) {
    const select = hooks.$('#marketplaceStandingOrderForm')?.elements.seller_shop_id;
    if (!select) return;
    const sellers = new Map();
    (state.orders || []).forEach((o) => {
      if (o.seller_shop_id) sellers.set(o.seller_shop_id, o.seller_display_name || 'Wholesale seller');
    });
    select.innerHTML = sellers.size
      ? [...sellers.entries()].map(([id, name]) => `<option value="${hooks.esc(id)}">${hooks.esc(name)}</option>`).join('')
      : '<option value="">Buy from a seller first to set up a standing order</option>';
  }

  function standingOrderCardHtml(hooks, so) {
    const itemLines = (so.items || []).map((i) => `${i.quantity} × ${hooks.esc(i.name)}`).join(', ');
    let action = '';
    if (so.due_today && !so.seller_verified) {
      action = '<span class="badge warn">Due today — this seller is no longer verified</span>';
    } else if (so.due_today && Array.isArray(so.preview)) {
      const anyAvailable = so.preview.some((p) => p.available);
      action = anyAvailable
        ? `<button type="button" class="primary" data-market-standing-order-add="${hooks.esc(so.id)}">Add today's order to cart</button>`
        : '<span class="badge warn">Due today — nothing currently available from this seller</span>';
    } else if (!so.seller_verified) {
      action = '<span class="badge warn">This seller is no longer verified</span>';
    }
    return `<article class="card marketplace-order-card">
      <div class="card-top">
        <div><h3>${hooks.esc(so.label)}${so.due_today ? ' <span class="badge good">Due today</span>' : ''}</h3><p class="meta">${hooks.esc(so.seller_display_name || 'Wholesale seller')} · Every ${CADENCE_LABELS[so.cadence_weekday] || so.cadence_weekday}${so.active ? '' : ' · Paused'}</p></div>
      </div>
      <p class="subtle">${itemLines}</p>
      <div class="card-actions">${action}<button type="button" class="secondary" data-market-edit-standing-order="${hooks.esc(so.id)}">Edit</button><button type="button" class="secondary danger" data-market-delete-standing-order="${hooks.esc(so.id)}">Delete</button></div>
    </article>`;
  }

  async function loadStandingOrdersList(hooks, state) {
    const mount = hooks.$('#marketplaceStandingOrdersList');
    if (!mount) return;
    try {
      const data = await hooks.api('marketplace-catalog?resource=standing-orders');
      state.standingOrders = data.standing_orders || [];
      mount.innerHTML = state.standingOrders.length
        ? state.standingOrders.map((so) => standingOrderCardHtml(hooks, so)).join('')
        : hooks.empty('No standing orders yet.');
    } catch (error) {
      mount.innerHTML = `<p class="subtle">${hooks.esc(error.message)}</p>`;
    }
  }

  function openStandingOrderForm(hooks, so) {
    const form = hooks.$('#marketplaceStandingOrderForm');
    if (!form) return;
    form.hidden = false;
    form.reset();
    if (so) {
      form.elements.id.value = so.id;
      form.elements.label.value = so.label || '';
      form.elements.seller_shop_id.value = so.seller_shop_id || '';
      form.elements.cadence_weekday.value = so.cadence_weekday || 'mon';
      form.elements.items.value = (so.items || []).map((i) => `${i.quantity}, ${i.name}`).join('\n');
    } else {
      form.elements.id.value = '';
    }
  }

  function parseStandingOrderItems(text) {
    return String(text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+(?:\.\d+)?)\s*[,x×]?\s*(.+)$/i);
        return m ? { quantity: Number(m[1]), name: m[2].trim() } : null;
      })
      .filter(Boolean);
  }

  /**
   * The real wholesaler storefront (Marketplace vision: WHOLESALER
   * STOREFRONTS) — location, delivery/pickup, ordering policy, contact,
   * and the seller's own featured products, not just a filtered product
   * grid with the seller's name typed into the search box.
   */
  function storefrontHtml(hooks, data) {
    const seller = data.seller || {};
    const location = [seller.location_city, seller.location_state, seller.location_country].filter(Boolean).join(', ');
    const facts = [
      location ? ['Location', location] : null,
      seller.delivery_area ? ['Delivery area', seller.delivery_area] : null,
      seller.delivery_radius_miles ? ['Delivery radius', `${seller.delivery_radius_miles} miles`] : null,
      seller.pickup_available ? ['Pickup', [seller.pickup_address, seller.pickup_hours].filter(Boolean).join(' · ') || 'Available'] : null,
      data.seller?.minimum_order_amount ? ['Minimum order', hooks.money(data.seller.minimum_order_amount)] : null,
      seller.order_deadline_note ? ['Order deadline', seller.order_deadline_note] : null,
      seller.contact_email ? ['Email', seller.contact_email] : null,
      seller.contact_phone ? ['Phone', seller.contact_phone] : null
    ].filter(Boolean);

    const featured = (data.featured || []).map((item) => productCard(item, hooks, { verifiedSeller: data.verified_seller })).join('');
    const allItems = (data.items || []).map((item) => productCard(item, hooks, { verifiedSeller: data.verified_seller })).join('');

    const summary = data.reviews_summary || {};
    const reviewsHeader = summary.count
      ? `⭐ ${summary.average} average (${summary.count} review${summary.count === 1 ? '' : 's'})`
      : 'No reviews yet — reviews come from florists who’ve actually completed an order.';
    const reviewRows = (data.reviews || []).map((r) => `
      <div class="marketplace-review-row">
        <strong>⭐ ${hooks.esc(r.rating)}/5</strong>
        <span class="subtle">${hooks.esc((r.created_at || '').slice(0, 10))}</span>
        ${r.comment ? `<p>${hooks.esc(r.comment)}</p>` : ''}
      </div>`).join('');

    return `<div class="marketplace-storefront">
      <button type="button" class="secondary" data-market-detail-close aria-label="Close storefront">Close</button>
      <h2>${hooks.esc(seller.display_name || 'Wholesale seller')}</h2>
      ${data.verified_seller ? '<span class="badge verified">Verified seller</span>' : ''}
      ${seller.bio ? `<p>${hooks.esc(seller.bio)}</p>` : ''}
      ${seller.website ? `<p class="subtle"><a href="${hooks.esc(seller.website)}" target="_blank" rel="noopener">${hooks.esc(seller.website)}</a></p>` : ''}
      ${facts.length ? `<dl class="marketplace-spec-sheet">${facts.map(([k, v]) => `<div><dt>${hooks.esc(k)}</dt><dd>${hooks.esc(String(v))}</dd></div>`).join('')}</dl>` : ''}
      ${seller.ordering_policy ? `<p class="subtle"><strong>Ordering policy:</strong> ${hooks.esc(seller.ordering_policy)}</p>` : ''}
      ${featured ? `<section><h3>Featured</h3><div class="product-grid compact">${featured}</div></section>` : ''}
      <section><h3>All products</h3><div class="product-grid compact">${allItems || hooks.empty('No published products yet.')}</div></section>
      <section><h3>Reviews</h3><p class="subtle">${hooks.esc(reviewsHeader)}</p>${reviewRows}</section>
    </div>`;
  }

  async function openStorefront(hooks, state, shopId) {
    const panel = hooks.$('#marketplaceDetailPanel');
    if (!panel || !shopId) return;
    panel.hidden = false;
    panel.innerHTML = '<p class="subtle">Loading storefront…</p>';
    try {
      const [data, reviewsData] = await Promise.all([
        hooks.api(`marketplace-catalog?shopId=${encodeURIComponent(shopId)}`),
        hooks.api(`marketplace-catalog?resource=seller-reviews&shopId=${encodeURIComponent(shopId)}`).catch(() => ({ reviews: [] }))
      ]);
      panel.innerHTML = storefrontHtml(hooks, { ...data, reviews: reviewsData.reviews || [] });
    } catch (error) {
      panel.innerHTML = `<p class="subtle">${hooks.esc(error.message)}</p>`;
    }
  }

  async function loadSellerDashboard(hooks, state) {
    const mount = hooks.$('#marketplaceSellerDashboard');
    if (!mount) return;
    mount.innerHTML = '<p class="subtle">Loading seller dashboard…</p>';
    try {
      const data = await hooks.api('marketplace-seller');
      state.seller = data;
      const verification = data.verification_status || 'unknown';
      const products = data.products || [];
      mount.innerHTML = `<div class="marketplace-seller-grid">
        <section class="panel"><h2>Store profile</h2><p class="subtle">${hooks.esc(data.profile?.display_name || data.profile?.bio || 'Add your storefront profile after migration apply.')}</p>
          <label>Display name<input id="sellerDisplayName" value="${hooks.esc(data.profile?.display_name || '')}"></label>
          <label>Bio<textarea id="sellerBio" rows="3">${hooks.esc(data.profile?.bio || '')}</textarea></label>
          <label>Minimum order ($)<input id="sellerMinOrder" type="number" step="0.01" value="${hooks.esc(data.profile?.minimum_order_amount ?? 0)}"></label>
          <button type="button" class="primary" id="sellerSaveProfile">Save profile</button>
        </section>
        <section class="panel"><h2>Verification</h2><p>Status: <strong>${hooks.esc(verification)}</strong></p><button type="button" class="secondary" id="sellerOpenVerification">Review verification</button></section>
        <section class="panel"><h2>Revenue summary</h2><p class="subtle">Estimated catalog value (not paid orders): <strong>${hooks.money(data.stats?.revenue_estimate || 0)}</strong></p><p class="subtle">Active products: ${data.stats?.product_count || 0}</p></section>
        <section class="panel"><h2>Low stock</h2>${(data.low_stock || []).length ? `<ul>${data.low_stock.map((p) => `<li>${hooks.esc(p.product_name)} (${p.available_quantity} left)</li>`).join('')}</ul>` : hooks.empty('No low-stock alerts.')}</section>
        <section class="panel wide"><h2>Products</h2><div class="seller-product-table">${products.length ? products.map((p) => `<article class="card"><div class="card-top"><div><h3>${hooks.esc(p.product_name)}</h3><p class="meta">${hooks.esc(p.category || '')} · Qty ${p.available_quantity ?? 0}</p></div><strong>${hooks.money(p.price)}</strong></div><div class="card-actions"><button type="button" class="secondary" data-seller-edit="${hooks.esc(p.id)}">Edit</button><button type="button" class="secondary danger" data-seller-archive="${hooks.esc(p.id)}">Archive</button></div></article>`).join('') : hooks.empty('No products yet.')}</div></section>
        <section class="panel"><h2>Best sellers</h2>${(data.best_sellers || []).length ? `<ul>${data.best_sellers.map((p) => `<li>${hooks.esc(p.product_name)}</li>`).join('')}</ul>` : hooks.empty('No sales data yet.')}</section>
        <section class="panel"><h2>Coupons</h2>${(data.promotions || []).length ? `<ul>${data.promotions.map((p) => `<li>${hooks.esc(p.code)} · ${p.percent_off}%</li>`).join('')}</ul>` : hooks.empty('No promotions configured.')}</section>
        <section class="panel"><h2>Shipping profiles</h2>${(data.shipping_profiles || []).length ? `<ul>${data.shipping_profiles.map((p) => `<li>${hooks.esc(p.name)}</li>`).join('')}</ul>` : hooks.empty('Add shipping profiles after migration apply.')}</section>
        <section class="panel"><h2>Pricing tiers</h2>${(data.pricing_tiers || []).length ? `<ul>${data.pricing_tiers.map((p) => `<li>${hooks.esc(p.name)} · ${p.discount_percent}% at ${p.min_quantity}+</li>`).join('')}</ul>` : hooks.empty('No pricing tiers yet.')}</section>
        <section class="panel wide"><h2>Bulk CSV import</h2><p class="subtle">Download the template, fill in products, then validate and import.</p>
          <div class="card-actions"><button type="button" class="secondary" id="sellerCsvTemplate">Download CSV template</button></div>
          <label>CSV file<input type="file" id="sellerCsvFile" accept=".csv,text/csv"></label>
          <textarea id="sellerCsvPreview" rows="6" placeholder="CSV preview appears here after validation."></textarea>
          <div class="card-actions"><button type="button" class="secondary" id="sellerCsvValidate">Validate CSV</button><button type="button" class="primary" id="sellerCsvImport">Import products</button></div>
        </section>
      </div>`;
      bindSellerDashboard(hooks, state);
    } catch (error) {
      mount.innerHTML = `<div class="panel"><p class="subtle">${hooks.esc(error.message)}</p></div>`;
    }
  }

  function bindSellerDashboard(hooks, state) {
    hooks.$('#sellerOpenVerification')?.addEventListener('click', () => hooks.openVerificationDialog?.());
    hooks.$('#sellerSaveProfile')?.addEventListener('click', async () => {
      try {
        await hooks.api('marketplace-seller', {
          method: 'PUT',
          body: JSON.stringify({
            display_name: hooks.$('#sellerDisplayName')?.value || '',
            bio: hooks.$('#sellerBio')?.value || '',
            minimum_order_amount: hooks.$('#sellerMinOrder')?.value || 0
          })
        });
        hooks.toast('Seller profile saved.');
        loadSellerDashboard(hooks, state);
      } catch (error) {
        hooks.toast(error.message);
      }
    });
    hooks.$('#sellerCsvTemplate')?.addEventListener('click', async () => {
      try {
        const data = await hooks.api('marketplace-seller?resource=csv-template');
        const blob = new Blob([data.csv || ''], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'bloom-marketplace-products.csv';
        link.click();
        URL.revokeObjectURL(url);
      } catch (error) {
        hooks.toast(error.message);
      }
    });
    hooks.$('#sellerCsvValidate')?.addEventListener('click', async () => {
      const file = hooks.$('#sellerCsvFile')?.files?.[0];
      if (!file) return hooks.toast('Choose a CSV file first.');
      const csv = await file.text();
      const result = await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'validate-csv', csv }) });
      hooks.$('#sellerCsvPreview').value = result.valid ? `Valid ${result.rows.length} rows.` : result.errors.join('\n');
    });
    hooks.$('#sellerCsvImport')?.addEventListener('click', async () => {
      const file = hooks.$('#sellerCsvFile')?.files?.[0];
      if (!file) return hooks.toast('Choose a CSV file first.');
      const csv = await file.text();
      try {
        const result = await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'import-csv', csv }) });
        hooks.toast(`Imported ${result.imported} products.`);
        loadSellerDashboard(hooks, state);
      } catch (error) {
        hooks.toast(error.message);
      }
    });
    document.querySelectorAll('[data-seller-archive]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'archive', id: button.dataset.sellerArchive }) });
          hooks.toast('Product archived.');
          loadSellerDashboard(hooks, state);
        } catch (error) {
          hooks.toast(error.message);
        }
      });
    });
  }

  function bindMarketplaceEvents(hooks, state) {
    document.getElementById('marketplacePage')?.addEventListener('click', async (event) => {
      const detail = event.target.closest('[data-market-detail]');
      if (detail) {
        event.preventDefault();
        openDetail(hooks, state, detail.dataset.marketDetail);
        return;
      }
      const closeDetail = event.target.closest('[data-market-detail-close]');
      if (closeDetail) {
        const panel = hooks.$('#marketplaceDetailPanel');
        if (panel) panel.hidden = true;
        return;
      }
      const favorite = event.target.closest('[data-market-favorite]');
      if (favorite) {
        event.preventDefault();
        try {
          const result = await hooks.api('marketplace-catalog', {
            method: 'POST',
            body: JSON.stringify({ action: 'favorite', listing_id: favorite.dataset.marketFavorite, toggle: favorite.classList.contains('active') })
          });
          favorite.classList.toggle('active', result.favorited);
          favorite.setAttribute('aria-pressed', result.favorited ? 'true' : 'false');
        } catch (error) {
          hooks.toast(error.message);
        }
        return;
      }
      const cartBtn = event.target.closest('[data-market-cart]');
      if (cartBtn) {
        event.preventDefault();
        const item = state.items.find((row) => row.id === cartBtn.dataset.marketCart);
        if (!item) return;
        const cart = readCart();
        if (!cart.some((row) => row.id === item.id)) cart.push({ id: item.id, product_name: item.product_name, price: item.price, quantity: 1 });
        writeCart(cart);
        hooks.toast('Saved to cart.');
        renderCartBadge(hooks);
        return;
      }
      const checkoutBtn = event.target.closest('[data-market-checkout]');
      if (checkoutBtn) {
        event.preventDefault();
        if (hooks.getVerificationStatus?.() !== 'approved') {
          hooks.openVerificationDialog?.();
          hooks.toast('Complete wholesale verification before checkout.');
          return;
        }
        try {
          const promoCode = (state.specials || []).length ? (window.prompt('Promo code (optional) — leave blank to skip:', '') || '').trim() : '';
          const result = await hooks.api('marketplace-checkout', {
            method: 'POST',
            body: JSON.stringify({ listing_id: checkoutBtn.dataset.marketCheckout, quantity: 1, ...(promoCode ? { promo_code: promoCode } : {}) })
          });
          if (result.url) window.location.href = result.url;
          else if (result.urls?.length) {
            hooks.toast(result.message || 'Open each supplier checkout.');
            window.location.href = result.urls[0];
          } else hooks.toast('Checkout session started.');
        } catch (error) {
          hooks.toast(error.message);
        }
      }
      const storefront = event.target.closest('[data-market-storefront]');
      if (storefront) {
        event.preventDefault();
        openStorefront(hooks, state, storefront.dataset.marketStorefront);
      }
    });

    ['marketplaceSearch', 'marketplaceCategory', 'marketplaceSellerFilter', 'marketplaceMinPrice', 'marketplaceMaxPrice', 'marketplaceInStock', 'marketplaceShipping', 'marketplaceVariety', 'marketplaceColor', 'marketplaceAvailability', 'marketplaceByDate'].forEach((id) => {
      hooks.$(`#${id}`)?.addEventListener('change', () => {
        state.q = hooks.$('#marketplaceSearch')?.value || '';
        state.category = hooks.$('#marketplaceCategory')?.value || '';
        state.seller = hooks.$('#marketplaceSellerFilter')?.value || '';
        state.minPrice = hooks.$('#marketplaceMinPrice')?.value || '';
        state.maxPrice = hooks.$('#marketplaceMaxPrice')?.value || '';
        state.inStock = Boolean(hooks.$('#marketplaceInStock')?.checked);
        state.shipping = hooks.$('#marketplaceShipping')?.value || '';
        state.variety = hooks.$('#marketplaceVariety')?.value || '';
        state.color = hooks.$('#marketplaceColor')?.value || '';
        state.availability = hooks.$('#marketplaceAvailability')?.value || '';
        state.byDate = hooks.$('#marketplaceByDate')?.value || '';
        loadBrowse(hooks, state);
      });
    });

    const marketplacePanels = ['#marketplaceBrowsePanel', '#marketplaceOrdersPanel', '#marketplaceSellPanel'];
    function showMarketplacePanel(hooks, activeId) {
      marketplacePanels.forEach((id) => hooks.$(id)?.classList.toggle('active', id === activeId));
      [hooks.$('#marketplaceTabBrowse'), hooks.$('#marketplaceTabOrders'), hooks.$('#marketplaceTabSell')].forEach((btn, i) => {
        btn?.classList.toggle('active', marketplacePanels[i] === activeId);
      });
    }
    hooks.$('#marketplaceTabBrowse')?.addEventListener('click', () => showMarketplacePanel(hooks, '#marketplaceBrowsePanel'));
    hooks.$('#marketplaceTabOrders')?.addEventListener('click', async () => {
      showMarketplacePanel(hooks, '#marketplaceOrdersPanel');
      await loadMyOrders(hooks, state);
      loadStandingOrdersList(hooks, state);
    });
    hooks.$('#marketplaceTabSell')?.addEventListener('click', () => showMarketplacePanel(hooks, '#marketplaceSellPanel'));

    hooks.$('[data-market-new-standing-order]')?.addEventListener('click', () => openStandingOrderForm(hooks, null));
    hooks.$('[data-market-cancel-standing-order]')?.addEventListener('click', () => {
      const form = hooks.$('#marketplaceStandingOrderForm');
      if (form) form.hidden = true;
    });
    hooks.$('#marketplaceStandingOrderForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fd = new FormData(form);
      const items = parseStandingOrderItems(fd.get('items'));
      if (!items.length) return hooks.toast('Add at least one item as "quantity, name".');
      try {
        await hooks.api('marketplace-catalog', {
          method: 'POST',
          body: JSON.stringify({
            action: 'save_standing_order',
            id: fd.get('id') || undefined,
            label: fd.get('label'),
            seller_shop_id: fd.get('seller_shop_id'),
            cadence_weekday: fd.get('cadence_weekday'),
            items
          })
        });
        form.hidden = true;
        hooks.toast('Standing order saved.');
        loadStandingOrdersList(hooks, state);
      } catch (error) {
        hooks.toast(error.message);
      }
    });

    hooks.$('#marketplaceStandingOrdersList')?.addEventListener('click', async (event) => {
      const editBtn = event.target.closest('[data-market-edit-standing-order]');
      if (editBtn) {
        const so = (state.standingOrders || []).find((row) => row.id === editBtn.dataset.marketEditStandingOrder);
        if (so) openStandingOrderForm(hooks, so);
        return;
      }
      const deleteBtn = event.target.closest('[data-market-delete-standing-order]');
      if (deleteBtn) {
        if (!window.confirm('Delete this standing order?')) return;
        try {
          await hooks.api('marketplace-catalog', { method: 'POST', body: JSON.stringify({ action: 'delete_standing_order', id: deleteBtn.dataset.marketDeleteStandingOrder }) });
          hooks.toast('Standing order deleted.');
          loadStandingOrdersList(hooks, state);
        } catch (error) {
          hooks.toast(error.message);
        }
        return;
      }
      const addBtn = event.target.closest('[data-market-standing-order-add]');
      if (addBtn) {
        const so = (state.standingOrders || []).find((row) => row.id === addBtn.dataset.marketStandingOrderAdd);
        if (!so?.preview) return;
        const cart = readCart();
        let added = 0;
        const unavailable = [];
        for (const item of so.preview) {
          if (!item.available || !item.listing_id) {
            unavailable.push(item.name);
            continue;
          }
          if (!cart.some((row) => row.id === item.listing_id)) {
            cart.push({ id: item.listing_id, product_name: item.matched_product_name || item.name, price: item.current_price, quantity: item.quantity });
            added += 1;
          }
        }
        writeCart(cart);
        renderCartBadge(hooks);
        hooks.toast(unavailable.length
          ? `Added ${added} item(s) at today's price. Not currently available: ${unavailable.join(', ')}.`
          : `Added ${added} item(s) to your cart at today's price.`);
      }
    });

    hooks.$('#marketplaceOrdersList')?.addEventListener('submit', async (event) => {
      const form = event.target.closest('[data-market-review-form]');
      if (!form) return;
      event.preventDefault();
      const fd = new FormData(form);
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        await hooks.api('marketplace-catalog', {
          method: 'POST',
          body: JSON.stringify({
            action: 'submit_review',
            order_id: form.dataset.marketReviewForm,
            rating: fd.get('rating'),
            fulfillment_rating: fd.get('fulfillment_rating') || undefined,
            communication_rating: fd.get('communication_rating') || undefined,
            accuracy_rating: fd.get('accuracy_rating') || undefined,
            comment: fd.get('comment') || ''
          })
        });
        hooks.toast('Review submitted. Thank you.');
        loadMyOrders(hooks, state);
      } catch (error) {
        hooks.toast(error.message);
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    hooks.$('#marketplaceOrdersList')?.addEventListener('submit', async (event) => {
      const refundForm = event.target.closest('[data-market-refund-form]');
      if (!refundForm) return;
      event.preventDefault();
      const fd = new FormData(refundForm);
      const submitBtn = refundForm.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        await hooks.api('marketplace-catalog', {
          method: 'POST',
          body: JSON.stringify({ action: 'request_refund', order_id: refundForm.dataset.marketRefundForm, reason: fd.get('reason') })
        });
        hooks.toast('Refund request sent to the seller.');
        loadMyOrders(hooks, state);
      } catch (error) {
        hooks.toast(error.message);
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    hooks.$('#marketplaceOrdersList')?.addEventListener('click', async (event) => {
      const receiveBtn = event.target.closest('[data-market-receive-order]');
      if (receiveBtn) {
        event.preventDefault();
        receiveBtn.disabled = true;
        receiveBtn.textContent = 'Adding to inventory…';
        try {
          const result = await hooks.api('marketplace-catalog', {
            method: 'POST',
            body: JSON.stringify({ action: 'receive_order', order_id: receiveBtn.dataset.marketReceiveOrder })
          });
          hooks.toast(`Added to inventory: ${result.matched_count} updated, ${result.created_count} new.`);
          loadMyOrders(hooks, state);
        } catch (error) {
          hooks.toast(error.message);
          receiveBtn.disabled = false;
          receiveBtn.textContent = 'Add to my inventory';
        }
        return;
      }

      const reviewBtn = event.target.closest('[data-market-review-order]');
      if (reviewBtn) {
        event.preventDefault();
        const form = hooks.$(`[data-market-review-form="${CSS.escape(reviewBtn.dataset.marketReviewOrder)}"]`);
        if (form) form.hidden = !form.hidden;
        return;
      }

      const refundBtn = event.target.closest('[data-market-refund-order]');
      if (refundBtn) {
        event.preventDefault();
        const form = hooks.$(`[data-market-refund-form="${CSS.escape(refundBtn.dataset.marketRefundOrder)}"]`);
        if (form) form.hidden = !form.hidden;
        return;
      }

      const reorderBtn = event.target.closest('[data-market-reorder]');
      if (reorderBtn) {
        event.preventDefault();
        reorderBtn.disabled = true;
        reorderBtn.textContent = 'Checking current availability…';
        try {
          // Never resubmit last time's price/availability blindly — every
          // line is re-checked against the listing's current state first.
          const preview = await hooks.api(`marketplace-catalog?resource=reorder-preview&order_id=${encodeURIComponent(reorderBtn.dataset.marketReorder)}`);
          const cart = readCart();
          let added = 0;
          const unavailable = [];
          for (const item of preview.items || []) {
            if (!item.available || !item.listing_id) {
              unavailable.push(item.name);
              continue;
            }
            if (!cart.some((row) => row.id === item.listing_id)) {
              cart.push({ id: item.listing_id, product_name: item.name, price: item.current_price, quantity: item.quantity });
              added += 1;
            }
          }
          writeCart(cart);
          renderCartBadge(hooks);
          if (added && !unavailable.length) {
            hooks.toast(`Added ${added} item(s) to your cart at today's price.`);
          } else if (added) {
            hooks.toast(`Added ${added} item(s) at today's price. No longer available: ${unavailable.join(', ')}.`);
          } else {
            hooks.toast(`None of these items are still available: ${unavailable.join(', ')}.`);
          }
        } catch (error) {
          hooks.toast(error.message);
        } finally {
          reorderBtn.disabled = false;
          reorderBtn.textContent = 'Reorder';
        }
      }
    });

    hooks.$('#marketplaceCartCheckout')?.addEventListener('click', async () => {
      const cart = readCart();
      if (!cart.length) return hooks.toast('Add items to your cart first.');
      if (hooks.getVerificationStatus?.() !== 'approved') {
        hooks.openVerificationDialog?.();
        return hooks.toast('Complete wholesale verification before checkout.');
      }
      try {
        const promoCode = (state.specials || []).length ? (window.prompt('Promo code (optional) — leave blank to skip:', '') || '').trim() : '';
        const result = await hooks.api('marketplace-checkout', {
          method: 'POST',
          body: JSON.stringify({ items: cart.map((row) => ({ listing_id: row.id, quantity: row.quantity || 1 })), ...(promoCode ? { promo_code: promoCode } : {}) })
        });
        if (result.url) {
          writeCart([]);
          renderCartBadge(hooks);
          window.location.href = result.url;
        } else if (result.urls?.length) {
          hooks.toast(result.message || 'Complete checkout for each supplier.');
          window.location.href = result.urls[0];
        }
      } catch (error) {
        // A 409 with structured item detail means specific cart lines are
        // now stale (sold out, deactivated, seller not onboarded) — clear
        // just those so the buyer can immediately retry with what's left,
        // instead of re-discovering the same block on a second attempt.
        if (Array.isArray(error.items) && error.items.length) {
          const staleIds = new Set(error.items.map((row) => row.listing_id).filter(Boolean));
          writeCart(readCart().filter((row) => !staleIds.has(row.id)));
          renderCartBadge(hooks);
        }
        hooks.toast(error.message);
      }
    });
  }

  function renderCartBadge(hooks) {
    const badge = hooks.$('#marketplaceCartCount');
    if (!badge) return;
    badge.textContent = String(readCart().length);
  }

  function renderCategoryOptions(hooks) {
    const select = hooks.$('#marketplaceCategory');
    const categories = (typeof globalThis !== 'undefined' && globalThis.BloomMarketplaceCategories?.MARKETPLACE_CATEGORIES) || [];
    if (!select || !categories.length) return;
    select.innerHTML = `<option value="">All categories</option>${categories.map((c) => `<option value="${hooks.esc(c.label)}">${hooks.esc(c.label)}</option>`).join('')}`;
  }

  function notificationRowHtml(hooks, note) {
    return `<div class="marketplace-notif-row${note.read_at ? '' : ' unread'}">
      <p>${hooks.esc(note.message)}</p>
      <small class="subtle">${hooks.esc((note.created_at || '').slice(0, 10))}</small>
    </div>`;
  }

  async function loadSpecials(hooks, state) {
    const mount = hooks.$('#marketplaceSpecialsSection');
    if (!mount) return;
    try {
      // Real, currently-active, VERIFIED-seller specials only — the
      // backend already applies isPromotionActive() and
      // loadVerifiedSellerShopIds(), so nothing here is redisplayed or
      // re-filtered, just rendered as-is.
      const data = await hooks.api('marketplace-catalog?resource=specials');
      state.specials = data.specials || [];
    } catch {
      state.specials = [];
    }
    if (!state.specials.length) {
      mount.innerHTML = '';
      return;
    }
    mount.innerHTML = `<section class="panel marketplace-specials"><h2>Current specials</h2><div class="cards">${state.specials.map((s) => `
      <article class="card"><h3>${hooks.esc(s.percent_off)}% off</h3><p class="subtle">${hooks.esc(s.seller_display_name || 'A seller')}${s.description ? ` — ${hooks.esc(s.description)}` : ''}</p><p class="meta">Code <strong>${hooks.esc(s.code)}</strong>${s.ends_at ? ` · ends ${hooks.esc(new Date(s.ends_at).toLocaleDateString())}` : ''}</p><div class="card-actions"><button type="button" class="secondary" data-market-copy-promo="${hooks.esc(s.code)}">Copy code</button></div></article>`).join('')}</div></section>`;
    mount.querySelectorAll('[data-market-copy-promo]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const code = btn.dataset.marketCopyPromo;
        try {
          await navigator.clipboard?.writeText(code);
          hooks.toast(`Copied "${code}" — enter it at checkout.`);
        } catch {
          hooks.toast(`Code: ${code} — enter it at checkout.`);
        }
      });
    });
  }

  async function loadNotifications(hooks, state) {
    try {
      const data = await hooks.api('marketplace-catalog?resource=notifications');
      state.notifications = data.notifications || [];
      const countEl = hooks.$('#marketplaceNotifCount');
      if (countEl) {
        countEl.hidden = !data.unread_count;
        countEl.textContent = String(data.unread_count || 0);
      }
    } catch {
      state.notifications = [];
    }
  }

  function renderNotifPanel(hooks, state) {
    const panel = hooks.$('#marketplaceNotifPanel');
    if (!panel) return;
    panel.innerHTML = (state.notifications || []).length
      ? (state.notifications || []).map((note) => notificationRowHtml(hooks, note)).join('')
      : '<p class="subtle">No notifications yet.</p>';
  }

  function bindNotifBell(hooks, state) {
    hooks.$('#marketplaceNotifBell')?.addEventListener('click', async () => {
      const panel = hooks.$('#marketplaceNotifPanel');
      if (!panel) return;
      const opening = panel.hidden;
      panel.hidden = !opening;
      if (!opening) return;
      renderNotifPanel(hooks, state);
      if ((state.notifications || []).some((n) => !n.read_at)) {
        try {
          await hooks.api('marketplace-catalog', { method: 'POST', body: JSON.stringify({ action: 'mark_notifications_read' }) });
          const countEl = hooks.$('#marketplaceNotifCount');
          if (countEl) countEl.hidden = true;
        } catch {
          // best-effort — an unread badge that doesn't clear isn't worth surfacing an error for.
        }
      }
    });
  }

  async function load(hooks) {
    const state = { items: [], orders: [], compare: [], notifications: [], standingOrders: [], specials: [], q: '', category: '', seller: '', minPrice: '', maxPrice: '', inStock: false, shipping: '', variety: '', color: '', availability: '', byDate: '' };
    renderCategoryOptions(hooks);
    renderCartBadge(hooks);
    bindMarketplaceEvents(hooks, state);
    bindNotifBell(hooks, state);
    await loadBrowse(hooks, state);
    await loadNotifications(hooks, state);
    await loadSpecials(hooks, state);
  }

  return { load, readCart, writeCart };
});
