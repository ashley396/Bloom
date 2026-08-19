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
      ['shipping', 'Shipping'],
      ['pricing', 'Pricing tiers'],
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
        <section class="panel"><h2>Verification</h2><p>Status: <strong>${hooks.esc(data.verification_status || 'unknown')}</strong></p><button type="button" class="secondary" data-wholesale-verify>Review verification</button></section>
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
      <div class="cards">${orders.length ? orders.map((o) => `<article class="card"><div class="card-top"><div><h3>Order ${hooks.esc(String(o.id).slice(0, 8))}</h3><p class="meta">${hooks.esc(o.status)} · ${hooks.esc(o.created_at || '')}</p></div><strong>${hooks.money(o.total)}</strong></div><div class="card-actions"><button type="button" class="secondary" data-wholesale-order-status="${hooks.esc(o.id)}" data-status="processing">Mark processing</button><button type="button" class="secondary" data-wholesale-order-status="${hooks.esc(o.id)}" data-status="fulfilled">Mark fulfilled</button></div></article>`).join('') : hooks.empty('No wholesale orders yet.')}</div>`;
  }

  function renderCustomers(hooks, data) {
    const customers = data.customers || [];
    return `${renderNav(hooks, 'customers')}
      <div class="heading-actions wholesale-toolbar"><button type="button" class="primary" data-wholesale-new-customer>+ Add customer</button></div>
      <div class="cards">${customers.length ? customers.map((c) => `<article class="card"><h3>${hooks.esc(c.company_name)}</h3><p class="meta">${hooks.esc(c.contact_name || '')} · ${hooks.esc(c.email || '')} · ${hooks.esc(c.phone || '')}</p>${c.notes ? `<p>${hooks.esc(c.notes)}</p>` : ''}</article>`).join('') : hooks.empty('Track florist and buyer accounts you sell to.')}</div>`;
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
      shipping: renderShipping,
      pricing: renderPricing,
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
