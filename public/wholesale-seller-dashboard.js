(function (root, factory) {
  const api = factory();
  root.BloomWholesaleSeller = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  let state = { data: null, section: 'dashboard', editingProduct: null };

  function statusBadge(status) {
    const map = { draft: 'Draft', preview: 'Preview', published: 'Published' };
    return map[status] || status || 'Draft';
  }

  function kpiCard(label, value, hint) {
    return `<article class="report-summary wholesale-kpi"><div><small>${label}</small><strong>${value}</strong>${hint ? `<p class="subtle">${hint}</p>` : ''}</div></article>`;
  }

  function renderNav(hooks, active) {
    const items = [
      ['dashboard', 'Dashboard'],
      ['products', 'Products'],
      ['orders', 'Orders'],
      ['customers', 'Customers'],
      ['profile', 'Store Profile'],
      ['shipping', 'Shipping'],
      ['pricing', 'Pricing tiers'],
      ['specials', 'Specials'],
      ['import', 'CSV import']
    ];
    return `<div class="wholesale-seller-nav">${items.map(([id, label]) => `<button type="button" class="secondary${active === id ? ' active' : ''}" data-wholesale-section="${id}">${label}</button>`).join('')}</div>`;
  }

  function renderDashboard(hooks, data) {
    const k = data.kpis || data.stats || {};
    // Published/Draft/Low-stock already show "—" only for genuinely
    // missing data (?? on undefined leaves a real 0 alone). Revenue and
    // Orders used to collapse missing data to a fake "$0"/"0" via `|| 0`
    // — showing "—" and "$0" side by side in the same row for the exact
    // same underlying reason (no data yet).
    return `${renderNav(hooks, 'dashboard')}
      <div class="report-summary wholesale-kpi-row">
        ${kpiCard('Published products', k.published_count ?? '—')}
        ${kpiCard('Draft products', k.draft_count ?? '—')}
        ${kpiCard('Low-stock alerts', k.low_stock_count ?? '—')}
        ${kpiCard('Wholesale revenue', k.revenue_total == null ? '—' : hooks.money(k.revenue_total))}
        ${kpiCard('Orders', k.order_count ?? '—', k.pending_order_count == null ? '' : `${k.pending_order_count} pending`)}
      </div>
      <div class="wholesale-seller-grid">
        <section class="panel"><h2>Verification</h2><p>Status: <strong>${hooks.esc(data.verification_status || 'unknown')}</strong></p><p class="subtle">${data.verification_status === 'approved' ? 'Your products are visible to buyers in the Wholesale Marketplace.' : 'Buyers cannot see your products in the Wholesale Marketplace until your verification is approved — this protects florists from unverified sellers.'}</p><button type="button" class="secondary" data-wholesale-verify>Review verification</button></section>
        <section class="panel"><h2>Best sellers</h2>${(data.best_sellers || []).length ? `<ul>${data.best_sellers.map((p) => `<li>${hooks.esc(p.product_name)}</li>`).join('')}</ul>` : hooks.empty('Publish products to see performance.')}</section>
        <section class="panel wide"><h2>Low-stock alerts</h2>${(data.low_stock || []).length ? `<ul>${data.low_stock.map((p) => `<li>${hooks.esc(p.product_name)} · ${p.available_quantity ?? p.inventory_total ?? 0} left</li>`).join('')}</ul>` : hooks.empty('Inventory levels look healthy.')}</section>
      </div>`;
  }

  function floralMetaLine(hooks, p) {
    const bits = [p.variety, p.color, p.grade].filter(Boolean);
    const availability = p.availability_status && p.availability_status !== 'available_now'
      ? `<span class="availability-badge status-${hooks.esc(p.availability_status)}">${hooks.esc((p.availability_status || '').replace(/_/g, ' '))}</span>`
      : '';
    if (!bits.length && !availability) return "";
    return `<p class="marketplace-floral-meta">${bits.map((b) => hooks.esc(b)).join(' · ')}${availability}</p>`;
  }

  function renderProducts(hooks, data) {
    const rows = (data.products || []).filter((p) => !p.archived_at);
    return `${renderNav(hooks, 'products')}
      <div class="heading-actions wholesale-toolbar"><button type="button" class="primary" data-wholesale-new-product>+ New product</button></div>
      <div class="cards">${rows.length ? rows.map((p) => `<article class="card"><div class="card-top"><div><h3>${hooks.esc(p.product_name)}</h3><p class="meta">${hooks.esc(p.sku || 'No SKU')} · ${statusBadge(p.publish_status)}${p.low_stock ? ' · Low stock' : ''}</p>${floralMetaLine(hooks, p)}</div><strong>${hooks.money(p.price)}</strong></div><p class="subtle">Inventory: ${p.inventory_total ?? p.available_quantity ?? 0} · ${(p.images || []).length} image(s) · ${(p.variants || []).length} variant(s)</p><div class="card-actions"><button type="button" class="secondary" data-wholesale-edit="${hooks.esc(p.id)}">Edit</button><button type="button" class="secondary" data-wholesale-preview="${hooks.esc(p.id)}">Preview</button><button type="button" class="primary" data-wholesale-publish="${hooks.esc(p.id)}">Publish</button><button type="button" class="secondary danger" data-wholesale-archive="${hooks.esc(p.id)}">Archive</button></div></article>`).join('') : hooks.empty('No products yet. Create your first wholesale listing.')}</div>`;
  }

  function renderOrders(hooks, data) {
    const orders = data.orders || [];
    return `${renderNav(hooks, 'orders')}
      <div class="cards">${orders.length ? orders.map((o) => `<article class="card"><div class="card-top"><div><h3>Order ${hooks.esc(String(o.id).slice(0, 8))}</h3><p class="meta">${hooks.esc(o.status)} · ${hooks.esc(o.created_at || '')}</p></div><strong>${hooks.money(o.total)}</strong></div>${o.refund_requested_at ? `<p class="badge warn">Refund requested: ${hooks.esc(o.refund_requested_reason || '')}</p>` : ''}<div class="card-actions"><button type="button" class="secondary" data-wholesale-order-status="${hooks.esc(o.id)}" data-status="processing">Mark processing</button><button type="button" class="secondary" data-wholesale-order-status="${hooks.esc(o.id)}" data-status="fulfilled">Mark fulfilled</button>${o.refund_requested_at ? `<button type="button" class="secondary" data-wholesale-stripe-dashboard>Open Stripe dashboard to refund</button>` : ''}</div></article>`).join('') : hooks.empty('No wholesale orders yet.')}</div>`;
  }

  function renderCustomers(hooks, data) {
    const customers = data.customers || [];
    return `${renderNav(hooks, 'customers')}
      <div class="heading-actions wholesale-toolbar"><button type="button" class="primary" data-wholesale-new-customer>+ Add customer</button></div>
      <div class="cards">${customers.length ? customers.map((c) => `<article class="card"><h3>${hooks.esc(c.company_name)}</h3><p class="meta">${hooks.esc(c.contact_name || '')} · ${hooks.esc(c.email || '')} · ${hooks.esc(c.phone || '')}</p>${c.notes ? `<p>${hooks.esc(c.notes)}</p>` : ''}</article>`).join('') : hooks.empty('Track florist and buyer accounts you sell to.')}</div>`;
  }

  function renderProfile(hooks, data) {
    const p = data.profile || {};
    const published = (data.products || []).filter((prod) => !prod.archived_at && prod.publish_status === 'published');
    const featuredSet = new Set(p.featured_listing_ids || []);
    return `${renderNav(hooks, 'profile')}
      <section class="panel wide"><h2>Store profile</h2><p class="subtle">This is what florists see when they open your storefront in the Wholesale Marketplace.</p>
      <form id="wholesaleProfileForm" class="verification-grid">
        <div class="two"><label>Display name<input name="display_name" value="${hooks.esc(p.display_name || '')}"></label><label>Website<input name="website" value="${hooks.esc(p.website || '')}" placeholder="https://..."></label></div>
        <label>Bio<textarea name="bio" rows="3">${hooks.esc(p.bio || '')}</textarea></label>
        <div class="three"><label>City<input name="location_city" value="${hooks.esc(p.location_city || '')}"></label><label>State<input name="location_state" value="${hooks.esc(p.location_state || '')}"></label><label>Country<input name="location_country" value="${hooks.esc(p.location_country || '')}"></label></div>
        <div class="two"><label>Delivery area<input name="delivery_area" value="${hooks.esc(p.delivery_area || '')}" placeholder="e.g. Dallas–Fort Worth, TX + OK"></label><label>Delivery radius (miles)<input name="delivery_radius_miles" type="number" step="1" min="0" value="${hooks.esc(p.delivery_radius_miles ?? '')}"></label></div>
        <label class="check"><input name="pickup_available" type="checkbox" ${p.pickup_available ? 'checked' : ''}> Local pickup available</label>
        <div class="two"><label>Pickup address<input name="pickup_address" value="${hooks.esc(p.pickup_address || '')}"></label><label>Pickup hours<input name="pickup_hours" value="${hooks.esc(p.pickup_hours || '')}" placeholder="Mon–Fri 7am–2pm"></label></div>
        <div class="two"><label>Minimum order ($)<input name="minimum_order_amount" type="number" step="0.01" min="0" value="${hooks.esc(p.minimum_order_amount ?? 0)}"></label><label>Order deadline<input name="order_deadline_note" value="${hooks.esc(p.order_deadline_note || '')}" placeholder="Order by 2pm for next-day"></label></div>
        <label>Ordering policy<textarea name="ordering_policy" rows="2" placeholder="Lead times, cancellations, substitutions...">${hooks.esc(p.ordering_policy || '')}</textarea></label>
        <div class="two"><label>Contact email<input name="contact_email" type="email" value="${hooks.esc(p.contact_email || '')}"></label><label>Contact phone<input name="contact_phone" value="${hooks.esc(p.contact_phone || '')}"></label></div>
        <label>Featured products <span class="subtle">(shown first on your storefront — pick up to 12 published products)</span>
          <span class="wholesale-featured-picker">${published.length ? published.map((prod) => `<label class="check"><input type="checkbox" name="featured_listing_ids" value="${hooks.esc(prod.id)}" ${featuredSet.has(prod.id) ? 'checked' : ''}> ${hooks.esc(prod.product_name)}</label>`).join('') : '<span class="subtle">Publish a product first to feature it.</span>'}</span>
        </label>
        <button type="submit" class="primary">Save store profile</button>
      </form>
      </section>`;
  }

  function renderShipping(hooks, data) {
    const profiles = data.shipping_profiles || [];
    return `${renderNav(hooks, 'shipping')}
      <section class="panel"><h2>Shipping profiles</h2><form id="wholesaleShippingForm" class="verification-grid"><label>Name<input name="name" required placeholder="Regional cold chain"></label><label>Rules (JSON)<textarea name="rules" rows="3" placeholder='{"regions":["TX","OK"],"flat_rate":18}'></textarea></label><button type="submit" class="primary">Save shipping profile</button></form></section>
      <div class="cards">${profiles.length ? profiles.map((p) => `<article class="card"><h3>${hooks.esc(p.name)}</h3><p class="subtle">${hooks.esc(JSON.stringify(p.rules || {}))}</p></article>`).join('') : hooks.empty('No shipping profiles yet.')}</div>`;
  }

  function renderPricing(hooks, data) {
    const tiers = data.pricing_tiers || [];
    return `${renderNav(hooks, 'pricing')}
      <section class="panel"><h2>Customer pricing tiers</h2><form id="wholesaleTierForm" class="verification-grid"><label>Tier name<input name="name" required placeholder="Volume florist"></label><label>Minimum quantity<input name="min_quantity" type="number" step="0.01" value="10"></label><label>Discount %<input name="discount_percent" type="number" step="0.01" value="5"></label><button type="submit" class="primary">Save pricing tier</button></form></section>
      <div class="cards">${tiers.length ? tiers.map((t) => `<article class="card"><h3>${hooks.esc(t.name)}</h3><p class="meta">${t.discount_percent}% off at ${t.min_quantity}+ units</p></article>`).join('') : hooks.empty('No pricing tiers yet.')}</div>`;
  }

  function renderSpecials(hooks, data) {
    const specials = data.promotions || [];
    // Real state only, computed the same way the buyer catalog computes
    // it — "Active" here means the row's own active flag AND inside its
    // real starts_at/ends_at window right now, not just "flag is on".
    const now = Date.now();
    const isLive = (p) => {
      if (p.active === false) return false;
      if (p.starts_at && Date.parse(p.starts_at) > now) return false;
      if (p.ends_at && Date.parse(p.ends_at) < now) return false;
      return true;
    };
    return `${renderNav(hooks, 'specials')}
      <section class="panel"><h2>Create a special</h2><p class="subtle">Verified buyers browsing the marketplace see a real, currently-active special automatically — no separate step to publish it. Enter it once at checkout time and buyers can redeem the code for the duration you set.</p>
      <form id="wholesaleSpecialForm" class="verification-grid">
        <label>Code<input name="code" required placeholder="SPRING15" maxlength="40"></label>
        <label>Discount %<input name="percent_off" type="number" step="0.01" min="0.01" max="100" value="10" required></label>
        <label>Description<input name="description" placeholder="15% off spring stock"></label>
        <label>Starts<input name="starts_at" type="date"></label>
        <label>Ends<input name="ends_at" type="date"></label>
        <button type="submit" class="primary">Save special</button>
      </form></section>
      <div class="cards">${specials.length ? specials.map((p) => `<article class="card"><h3>${hooks.esc(p.code)}${isLive(p) ? ' <span class="badge">Live</span>' : ' <span class="badge warn">Not active</span>'}</h3><p class="meta">${p.percent_off}% off${p.ends_at ? ` · ends ${hooks.esc(new Date(p.ends_at).toLocaleDateString())}` : ''}</p>${p.description ? `<p class="subtle">${hooks.esc(p.description)}</p>` : ''}<div class="card-actions"><button type="button" class="secondary" data-wholesale-special-toggle="${hooks.esc(p.id)}" data-active="${p.active}">${p.active ? 'Deactivate' : 'Reactivate'}</button></div></article>`).join('') : hooks.empty('No specials yet — create one above and verified buyers will see it in the marketplace.')}</div>`;
  }

  function renderImport(hooks) {
    return `${renderNav(hooks, 'import')}
      <section class="panel wide"><h2>Bulk CSV import</h2><p class="subtle">Import draft products with SKU, inventory, and optional publish status.</p>
      <div class="card-actions"><button type="button" class="secondary" data-wholesale-csv-template>Download template</button></div>
      <label>CSV file<input type="file" id="wholesaleCsvFile" accept=".csv,text/csv"></label>
      <textarea id="wholesaleCsvPreview" rows="8" class="wide" placeholder="Validation results appear here."></textarea>
      <div class="card-actions"><button type="button" class="secondary" data-wholesale-csv-validate>Validate</button><button type="button" class="primary" data-wholesale-csv-import>Import</button></div></section>`;
  }

  function renderSection(hooks) {
    const mount = hooks.$('#wholesaleSellerRoot');
    if (!mount || !state.data) return;
    const data = state.data;
    const html = {
      dashboard: renderDashboard,
      products: renderProducts,
      orders: renderOrders,
      customers: renderCustomers,
      profile: renderProfile,
      shipping: renderShipping,
      pricing: renderPricing,
      specials: renderSpecials,
      import: renderImport
    }[state.section]?.(hooks, data) || renderDashboard(hooks, data);
    mount.innerHTML = html;
    bindSectionEvents(hooks);
  }

  async function reload(hooks) {
    const mount = hooks.$('#wholesaleSellerRoot');
    if (mount) mount.innerHTML = '<p class="subtle">Loading wholesale seller dashboard…</p>';
    state.data = await hooks.api('marketplace-seller');
    renderSection(hooks);
  }

  const FLORAL_TEXT_FIELDS = ['variety', 'color', 'grade', 'grower_name', 'origin', 'delivery_region', 'pickup_city', 'pickup_state', 'substitution_note'];
  const FLORAL_NUMBER_FIELDS = ['stem_length_in', 'stems_per_bunch', 'bunches_per_box', 'case_quantity', 'price_per_stem', 'price_per_bunch', 'price_per_box', 'price_per_case', 'lead_time_days'];
  const FLORAL_DATE_FIELDS = ['available_from', 'available_until'];

  function setSeasonalMonths(months) {
    const set = new Set((months || []).map((m) => String(m)));
    document.querySelectorAll('#wholesaleSeasonalMonths input[type="checkbox"]').forEach((box) => {
      box.checked = set.has(box.value);
    });
  }

  function readSeasonalMonths() {
    return Array.from(document.querySelectorAll('#wholesaleSeasonalMonths input[type="checkbox"]:checked')).map((box) => Number(box.value));
  }

  function openProductDialog(hooks, product) {
    const dialog = hooks.$('#wholesaleProductDialog');
    const form = hooks.$('#wholesaleProductForm');
    if (!dialog || !form) return;
    state.editingProduct = product || null;
    form.reset();
    if (product) {
      form.elements.id.value = product.id;
      form.elements.product_name.value = product.product_name || '';
      form.elements.sku.value = product.sku || '';
      form.elements.supplier_name.value = product.supplier_name || '';
      form.elements.category.value = product.category || 'Fresh Flowers';
      form.elements.unit.value = product.unit || 'each';
      form.elements.price.value = product.price ?? '';
      form.elements.available_quantity.value = product.available_quantity ?? '';
      form.elements.low_stock_threshold.value = product.low_stock_threshold ?? 5;
      form.elements.description.value = product.description || '';
      hooks.$('#wholesaleImageUrls').value = (product.images || []).map((img) => img.url).join('\n');
      hooks.$('#wholesaleVariantsJson').value = JSON.stringify(product.variants || [], null, 2);
      hooks.$('#wholesalePublishStatus').textContent = statusBadge(product.publish_status);
      FLORAL_TEXT_FIELDS.forEach((field) => { if (form.elements[field]) form.elements[field].value = product[field] || ''; });
      FLORAL_NUMBER_FIELDS.forEach((field) => { if (form.elements[field]) form.elements[field].value = product[field] ?? ''; });
      FLORAL_DATE_FIELDS.forEach((field) => { if (form.elements[field]) form.elements[field].value = product[field] || ''; });
      if (form.elements.availability_status) form.elements.availability_status.value = product.availability_status || 'available_now';
      setSeasonalMonths(product.seasonal_months);
    } else {
      form.elements.id.value = '';
      hooks.$('#wholesaleImageUrls').value = '';
      hooks.$('#wholesaleVariantsJson').value = '[]';
      hooks.$('#wholesalePublishStatus').textContent = 'Draft';
      setSeasonalMonths([]);
    }
    dialog.showModal();
  }

  async function saveProduct(hooks) {
    const form = hooks.$('#wholesaleProductForm');
    if (!form) return;
    const fd = new FormData(form);
    const images = String(hooks.$('#wholesaleImageUrls')?.value || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((url, index) => ({ url, sort_order: index }));
    let variants = [];
    try {
      variants = JSON.parse(hooks.$('#wholesaleVariantsJson')?.value || '[]');
    } catch {
      hooks.toast('Variant JSON is invalid.');
      return;
    }
    const body = {
      action: 'save-product',
      id: fd.get('id') || undefined,
      product_name: fd.get('product_name'),
      sku: fd.get('sku'),
      supplier_name: fd.get('supplier_name'),
      category: fd.get('category'),
      unit: fd.get('unit'),
      price: fd.get('price'),
      available_quantity: fd.get('available_quantity'),
      low_stock_threshold: fd.get('low_stock_threshold'),
      description: fd.get('description'),
      publish_status: 'draft',
      images,
      variants,
      image_url: images[0]?.url || '',
      availability_status: fd.get('availability_status') || 'available_now',
      seasonal_months: readSeasonalMonths()
    };
    FLORAL_TEXT_FIELDS.concat(FLORAL_NUMBER_FIELDS, FLORAL_DATE_FIELDS).forEach((field) => {
      const value = fd.get(field);
      if (value !== null) body[field] = value;
    });
    await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify(body) });
    hooks.$('#wholesaleProductDialog')?.close();
    hooks.toast('Product saved.');
    await reload(hooks);
  }

  function bindSectionEvents(hooks) {
    document.querySelectorAll('[data-wholesale-section]').forEach((button) => {
      button.addEventListener('click', () => {
        state.section = button.dataset.wholesaleSection;
        renderSection(hooks);
      });
    });
    document.querySelector('[data-wholesale-verify]')?.addEventListener('click', () => hooks.openVerificationDialog?.());
    document.querySelectorAll('[data-wholesale-stripe-dashboard]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          // Refunds are executed on Stripe's own Express Connect
          // dashboard, not inside Florisyn — it already gets the
          // application-fee math right for a destination charge.
          const result = await hooks.api('stripe-connect', { method: 'POST', body: JSON.stringify({ action: 'dashboard' }) });
          if (result.url) window.open(result.url, '_blank', 'noopener');
        } catch (error) {
          hooks.toast(error.message);
        }
      });
    });
    hooks.$('[data-wholesale-new-product]')?.addEventListener('click', () => openProductDialog(hooks, null));
    document.querySelectorAll('[data-wholesale-edit]').forEach((button) => {
      button.addEventListener('click', async () => {
        const result = await hooks.api(`marketplace-seller?product_id=${encodeURIComponent(button.dataset.wholesaleEdit)}`);
        openProductDialog(hooks, result.product);
      });
    });
    document.querySelectorAll('[data-wholesale-preview]').forEach((button) => {
      button.addEventListener('click', async () => {
        await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'publish', id: button.dataset.wholesalePreview, transition: 'to_preview' }) });
        hooks.toast('Product moved to preview.');
        reload(hooks);
      });
    });
    document.querySelectorAll('[data-wholesale-publish]').forEach((button) => {
      button.addEventListener('click', async () => {
        await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'publish', id: button.dataset.wholesalePublish, transition: 'publish' }) });
        hooks.toast('Product published to Florisyn Wholesale.');
        reload(hooks);
      });
    });
    document.querySelectorAll('[data-wholesale-archive]').forEach((button) => {
      button.addEventListener('click', async () => {
        await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'archive', id: button.dataset.wholesaleArchive }) });
        hooks.toast('Product archived.');
        reload(hooks);
      });
    });
    document.querySelectorAll('[data-wholesale-order-status]').forEach((button) => {
      button.addEventListener('click', async () => {
        await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'update-order', id: button.dataset.wholesaleOrderStatus, status: button.dataset.status }) });
        hooks.toast('Order updated.');
        reload(hooks);
      });
    });
    hooks.$('[data-wholesale-new-customer]')?.addEventListener('click', async () => {
      const company_name = window.prompt('Company name');
      if (!company_name) return;
      await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'save-customer', company_name }) });
      hooks.toast('Customer saved.');
      reload(hooks);
    });
    hooks.$('#wholesaleProfileForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fd = new FormData(form);
      const featured_listing_ids = Array.from(form.querySelectorAll('input[name="featured_listing_ids"]:checked')).map((box) => box.value);
      try {
        await hooks.api('marketplace-seller', {
          method: 'PUT',
          body: JSON.stringify({
            display_name: fd.get('display_name') || '',
            bio: fd.get('bio') || '',
            website: fd.get('website') || '',
            minimum_order_amount: fd.get('minimum_order_amount') || 0,
            location_city: fd.get('location_city') || '',
            location_state: fd.get('location_state') || '',
            location_country: fd.get('location_country') || '',
            delivery_area: fd.get('delivery_area') || '',
            delivery_radius_miles: fd.get('delivery_radius_miles') || '',
            pickup_available: form.elements.pickup_available?.checked || false,
            pickup_address: fd.get('pickup_address') || '',
            pickup_hours: fd.get('pickup_hours') || '',
            ordering_policy: fd.get('ordering_policy') || '',
            order_deadline_note: fd.get('order_deadline_note') || '',
            contact_email: fd.get('contact_email') || '',
            contact_phone: fd.get('contact_phone') || '',
            featured_listing_ids
          })
        });
        hooks.toast('Store profile saved.');
        reload(hooks);
      } catch (error) {
        hooks.toast(error.message);
      }
    });
    hooks.$('#wholesaleShippingForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      let rules = {};
      try {
        rules = JSON.parse(fd.get('rules') || '{}');
      } catch {
        hooks.toast('Rules must be valid JSON.');
        return;
      }
      await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'save-shipping', name: fd.get('name'), rules }) });
      hooks.toast('Shipping profile saved.');
      reload(hooks);
    });
    hooks.$('#wholesaleTierForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'save-tier', name: fd.get('name'), min_quantity: fd.get('min_quantity'), discount_percent: fd.get('discount_percent') }) });
      hooks.toast('Pricing tier saved.');
      reload(hooks);
    });
    hooks.$('#wholesaleSpecialForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      try {
        await hooks.api('marketplace-seller', {
          method: 'POST',
          body: JSON.stringify({
            action: 'save-promotion',
            code: fd.get('code'),
            percent_off: fd.get('percent_off'),
            description: fd.get('description') || '',
            starts_at: fd.get('starts_at') || null,
            ends_at: fd.get('ends_at') || null
          })
        });
        hooks.toast('Special saved.');
        reload(hooks);
      } catch (error) {
        hooks.toast(error.message);
      }
    });
    document.querySelectorAll('[data-wholesale-special-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active === 'true';
        await hooks.api('marketplace-seller', {
          method: 'POST',
          body: JSON.stringify({ action: 'toggle-promotion', id: btn.dataset.wholesaleSpecialToggle, active: !active })
        });
        hooks.toast(active ? 'Special deactivated.' : 'Special reactivated.');
        reload(hooks);
      });
    });
    hooks.$('[data-wholesale-csv-template]')?.addEventListener('click', async () => {
      const data = await hooks.api('marketplace-seller?resource=csv-template');
      const blob = new Blob([data.csv || ''], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bloom-wholesale-products.csv';
      link.click();
      URL.revokeObjectURL(url);
    });
    hooks.$('[data-wholesale-csv-validate]')?.addEventListener('click', async () => {
      const file = hooks.$('#wholesaleCsvFile')?.files?.[0];
      if (!file) return hooks.toast('Choose a CSV file.');
      const csv = await file.text();
      const result = await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'validate-csv', csv }) });
      hooks.$('#wholesaleCsvPreview').value = result.valid ? `Valid ${result.rows.length} rows.` : result.errors.join('\n');
    });
    hooks.$('[data-wholesale-csv-import]')?.addEventListener('click', async () => {
      const file = hooks.$('#wholesaleCsvFile')?.files?.[0];
      if (!file) return hooks.toast('Choose a CSV file.');
      const csv = await file.text();
      const result = await hooks.api('marketplace-seller', { method: 'POST', body: JSON.stringify({ action: 'import-csv', csv }) });
      hooks.toast(`Imported ${result.imported} products.`);
      reload(hooks);
    });
    hooks.$('#wholesaleProductForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await saveProduct(hooks);
      } catch (error) {
        hooks.toast(error.message);
      }
    });
    hooks.$('#wholesaleAiDescription')?.addEventListener('click', async () => {
      const target = hooks.$('#wholesaleProductDescription');
      if (!target || !hooks.runAiDescription) return;
      await hooks.runAiDescription(target);
    });
  }

  async function load(hooks) {
    state.section = 'dashboard';
    await reload(hooks);
  }

  return { load, reload, openProductDialog };
});
