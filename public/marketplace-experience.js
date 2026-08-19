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
    renderBrowse(hooks, state);
  }

  function renderBrowse(hooks, state) {
    const grid = hooks.$('#marketplaceBrowseGrid');
    const empty = hooks.$('#marketplaceBrowseEmpty');
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
    return `<article class="card marketplace-order-card">
      <div class="card-top">
        <div><h3>${hooks.esc(order.seller_display_name || 'Wholesale order')}</h3><p class="meta">${hooks.esc(statusLabel)} · ${hooks.esc((order.created_at || '').slice(0, 10))}</p></div>
        <strong>${hooks.money(order.total)}</strong>
      </div>
      <p class="subtle">${itemLines || 'No items on file.'}</p>
      <div class="card-actions">${receiveAction}</div>
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
    </div>`;
  }

  async function openStorefront(hooks, state, shopId) {
    const panel = hooks.$('#marketplaceDetailPanel');
    if (!panel || !shopId) return;
    panel.hidden = false;
    panel.innerHTML = '<p class="subtle">Loading storefront…</p>';
    try {
      const data = await hooks.api(`marketplace-catalog?shopId=${encodeURIComponent(shopId)}`);
      panel.innerHTML = storefrontHtml(hooks, data);
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
          const result = await hooks.api('marketplace-checkout', {
            method: 'POST',
            body: JSON.stringify({ listing_id: checkoutBtn.dataset.marketCheckout, quantity: 1 })
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
    hooks.$('#marketplaceTabOrders')?.addEventListener('click', () => {
      showMarketplacePanel(hooks, '#marketplaceOrdersPanel');
      loadMyOrders(hooks, state);
    });
    hooks.$('#marketplaceTabSell')?.addEventListener('click', () => showMarketplacePanel(hooks, '#marketplaceSellPanel'));

    hooks.$('#marketplaceOrdersList')?.addEventListener('click', async (event) => {
      const receiveBtn = event.target.closest('[data-market-receive-order]');
      if (!receiveBtn) return;
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
    });

    hooks.$('#marketplaceCartCheckout')?.addEventListener('click', async () => {
      const cart = readCart();
      if (!cart.length) return hooks.toast('Add items to your cart first.');
      if (hooks.getVerificationStatus?.() !== 'approved') {
        hooks.openVerificationDialog?.();
        return hooks.toast('Complete wholesale verification before checkout.');
      }
      try {
        const result = await hooks.api('marketplace-checkout', {
          method: 'POST',
          body: JSON.stringify({ items: cart.map((row) => ({ listing_id: row.id, quantity: row.quantity || 1 })) })
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

  async function load(hooks) {
    const state = { items: [], orders: [], q: '', category: '', seller: '', minPrice: '', maxPrice: '', inStock: false, shipping: '', variety: '', color: '', availability: '', byDate: '' };
    renderCategoryOptions(hooks);
    renderCartBadge(hooks);
    bindMarketplaceEvents(hooks, state);
    await loadBrowse(hooks, state);
  }

  return { load, readCart, writeCart };
});
