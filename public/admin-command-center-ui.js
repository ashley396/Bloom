const ccCall = (path, opt) => window.__adminCall(path, opt);

function readBetaChecks() {
  try {
    const parsed = JSON.parse(localStorage.getItem('bloom_beta_readiness_checks') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    localStorage.removeItem('bloom_beta_readiness_checks');
    return {};
  }
}

function chartBars(series = [], label) {
  if (!series.length) {
    return `<article class="panel chart-panel"><h3>${label}</h3><p class="chart-empty">No data yet — this fills in once activity comes in.</p></article>`;
  }
  const max = Math.max(1, ...series.map((s) => Number(s.value || 0)));
  return `<article class="panel chart-panel"><h3>${label}</h3><div class="chart-bars">${series.map((s) => `<div class="chart-bar"><span>${s.label}</span><div class="bar-track"><i style="width:${Math.round((Number(s.value || 0) / max) * 100)}%"></i></div><strong>${Number(s.value || 0).toLocaleString()}</strong></div>`).join('')}</div></article>`;
}

export function initCommandCenter(deps) {
  window.__adminCall = deps.call;
  const { $, $$, toast, escapeHtml, setView } = deps;

  $$('[data-theme-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const next = document.body.dataset.adminTheme === 'dark' ? 'light' : 'dark';
      document.body.dataset.adminTheme = next;
      localStorage.setItem('bloom_admin_theme', next);
    };
  });
  const savedTheme = localStorage.getItem('bloom_admin_theme');
  if (savedTheme) document.body.dataset.adminTheme = savedTheme;

  async function loadExecutiveDashboard() {
    const mount = $('#commandDashboard');
    if (!mount) return;
    mount.innerHTML = '<p class="quiet">Loading executive dashboard…</p>';
    try {
      const d = await ccCall('admin-command-center?action=dashboard');
      const k = d.kpis || {};
      // Every count card above already uses `?? '—'`, showing a dash only
      // for genuinely missing data and a real 0 for a known zero. This
      // used to always format to "$0" instead — even for missing data —
      // so a thin response showed "—" and "$0" side by side in the same
      // row of peer cards for the exact same underlying reason.
      const money = (n) => n == null ? '—' : Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
      mount.innerHTML = `
        <div class="metric-grid executive-grid">
          ${[
            ['Total florists', k.total_florists ?? '—'],
            ['Marketplace sellers', k.total_marketplace_sellers ?? '—'],
            ['Marketplace listings', k.total_marketplace_listings ?? '—'],
            ['Pending verifications', k.pending_florist_verifications ?? '—'],
            ['Pending approvals', k.pending_marketplace_approvals ?? '—'],
            ['Total orders', k.total_orders ?? '—'],
            ['Gross marketplace sales', money(k.gross_marketplace_sales)],
            ['MRR', money(k.monthly_recurring_revenue)],
            ['Active subscriptions', k.active_subscriptions ?? '—'],
            ['AI requests today', k.ai_requests_today ?? '—']
          ].map(([a, b]) => `<article class="metric"><small>${a}</small><strong>${b}</strong></article>`).join('')}
        </div>
        <div class="overview-grid charts-grid">
          ${chartBars(d.charts?.revenue || [], 'Revenue')}
          ${chartBars(d.charts?.new_customers || [], 'New customers')}
          ${chartBars(d.charts?.marketplace_orders || [], 'Marketplace orders')}
          ${chartBars(d.charts?.subscription_growth || [], 'Subscription growth')}
        </div>`;
    } catch (err) {
      mount.innerHTML = `<p class="quiet">${escapeHtml(err.message)}</p>`;
    }
  }

  async function loadUsers() {
    const q = encodeURIComponent($('#userSearch')?.value || '');
    const role = encodeURIComponent($('#userRoleFilter')?.value || '');
    const d = await ccCall(`admin-command-center?action=users&search=${q}&role=${role}`);
    $('#usersList').innerHTML = (d.users || []).length
      ? d.users.map((u) => `<article class="shop-row user-row"><div><strong>${escapeHtml(u.shops?.name || 'Shop')}</strong><small>${escapeHtml(u.user_id)} · ${escapeHtml(u.role)}</small></div><span>${escapeHtml(u.shops?.email || '')}</span><button data-suspend-shop="${u.shop_id}" class="secondary">Suspend</button><button data-reactivate-shop="${u.shop_id}" class="secondary">Reactivate</button><button data-reset-user="${u.user_id}">Reset workflow</button></article>`).join('')
      : '<p class="quiet">No users match this filter.</p>';
    $$('[data-suspend-shop]').forEach((b) => b.onclick = async () => {
      await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'suspend-user', shop_id: b.dataset.suspendShop }) });
      toast('Shop suspended'); loadUsers();
    });
    $$('[data-reactivate-shop]').forEach((b) => b.onclick = async () => {
      await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'reactivate-user', shop_id: b.dataset.reactivateShop }) });
      toast('Shop reactivated'); loadUsers();
    });
    $$('[data-reset-user]').forEach((b) => b.onclick = async () => {
      await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'password-reset-workflow', user_id: b.dataset.resetUser }) });
      toast('Password reset workflow recorded');
    });
    $('#adminsList').innerHTML = (d.admins || []).map((a) => `<article class="shop-row"><div><strong>${escapeHtml(a.display_name || a.user_id)}</strong><small>${escapeHtml(a.role)}</small></div><span class="badge">${a.active ? 'Active' : 'Inactive'}</span></article>`).join('');
  }

  async function loadMarketplaceAdmin() {
    const d = await ccCall('admin-command-center?action=marketplace');
    $('#marketplaceAdminListings').innerHTML = (d.listings || []).map((l) => `<article class="shop-row"><div><strong>${escapeHtml(l.product_name)}</strong><small>${escapeHtml(l.supplier_name || '')} · ${escapeHtml(l.admin_review_status || 'approved')}</small></div><button data-listing-decision="${l.id}" data-decision="approve">Approve</button><button data-listing-decision="${l.id}" data-decision="reject" class="secondary">Reject</button><button data-listing-decision="${l.id}" data-decision="feature" class="secondary">Feature</button><button data-listing-decision="${l.id}" data-decision="suspend" class="secondary">Suspend</button><button data-listing-decision="${l.id}" data-decision="remove" class="secondary danger">Remove</button></article>`).join('') || '<p class="quiet">No listings.</p>';
    $('#marketplaceAdminVerifications').innerHTML = (d.verifications || []).map((v) => `<article class="shop-row"><div><strong>${escapeHtml(v.status)}</strong><small>${escapeHtml(v.id)}</small></div><a class="secondary" href="/.netlify/functions/marketplace-verification-admin" hidden>API</a><span>Use verification admin API for decisions</span></article>`).join('') || '<p class="quiet">No verification queue (or migration not applied).</p>';
    $$('[data-listing-decision]').forEach((b) => b.onclick = async () => {
      await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'marketplace-listing', listing_id: b.dataset.listingDecision, decision: b.dataset.decision }) });
      toast('Listing updated'); loadMarketplaceAdmin();
    });
  }

  async function loadSupport() {
    const d = await ccCall('admin-command-center?action=support');
    const deliveryLabel = { delivered: 'sent', webhook_error: 'endpoint rejected it', not_configured: 'no endpoint connected' };
    $('#supportList').innerHTML = (d.items || []).map((item) => {
      const fixRequests = (item.notes || []).filter((n) => n.type === 'fix_request');
      const lastFixRequest = fixRequests[fixRequests.length - 1];
      const fixHistory = lastFixRequest
        ? `<p class="quiet">Last fix request: ${new Date(lastFixRequest.at).toLocaleString()} — ${escapeHtml(deliveryLabel[lastFixRequest.delivery] || lastFixRequest.delivery)}.</p>`
        : '';
      return `<article class="panel support-item"><div class="panel-head"><div><h3>${escapeHtml(item.subject)}</h3><p>${escapeHtml(item.item_type)} · ${escapeHtml(item.status)}</p></div></div><p>${escapeHtml(item.body)}</p>${fixHistory}<div class="card-actions"><button data-support-id="${item.id}" data-status="assigned">Assign</button><button data-support-id="${item.id}" data-status="resolved" class="secondary">Resolve</button><button data-support-id="${item.id}" data-status="closed" class="secondary">Close</button><button data-request-fix-id="${item.id}" class="secondary">Request Claude Code fix</button></div></article>`;
    }).join('') || '<p class="quiet">No support items yet.</p>';
    $$('[data-support-id]').forEach((b) => b.onclick = async () => {
      await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'support-update', id: b.dataset.supportId, status: b.dataset.status, note: 'Updated from Command Center' }) });
      toast('Support item updated'); loadSupport();
    });
    $$('[data-request-fix-id]').forEach((b) => b.onclick = async () => {
      b.disabled = true;
      try {
        const result = await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'support-request-fix', id: b.dataset.requestFixId }) });
        toast(result.message || 'Fix request recorded');
      } finally {
        loadSupport();
        loadBudQueue();
      }
    });
    await loadBudQueue();
  }

  const BUD_STATUSES = ['queued', 'investigating', 'diff_ready', 'awaiting_approval', 'shipped', 'dismissed'];
  const BUD_STATUS_LABELS = { queued: 'Queued', investigating: 'Investigating', diff_ready: 'Diff ready', awaiting_approval: 'Awaiting approval', shipped: 'Shipped', dismissed: 'Dismissed' };

  // Bud's Fix Queue — where a "Request Claude Code fix" click above
  // actually lands once CLAUDE_CODE_FIX_WEBHOOK_URL is configured. Shows
  // the request is real and queued rather than just trusting the
  // "delivered" toast.
  async function loadBudQueue() {
    const root = $('#budQueueRoot');
    if (!root) return;
    let d;
    try {
      d = await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'bud-queue-list' }) });
    } catch (err) {
      root.innerHTML = `<p class="quiet">${escapeHtml(err.message)}</p>`;
      return;
    }
    const items = d.items || [];
    root.innerHTML = `<div class="panel-head bud-queue-head"><img src="/assets/assistants/bud-portrait.webp" alt="" class="bud-queue-avatar"><div><h3>Bud's Fix Queue</h3><p class="quiet">Every "Request Claude Code fix" click lands here — nothing is fixed automatically; an agent session picks these up per docs/FLORISYN_AI_AGENT_AUTONOMY_POLICY.md.</p></div></div>` +
      (items.length
        ? items.map((it) => `<article class="panel bud-queue-item">
            <div class="panel-head"><div><h4>${escapeHtml(it.subject)}</h4><p class="quiet">Requested ${new Date(it.requested_at || it.created_at).toLocaleString()}${it.shop_id ? ` · shop ${escapeHtml(it.shop_id)}` : ''}</p></div></div>
            ${it.body ? `<p>${escapeHtml(it.body)}</p>` : ''}
            <div class="card-actions">
              <select data-bud-status-select="${it.id}">${BUD_STATUSES.map((s) => `<option value="${s}" ${s === it.status ? 'selected' : ''}>${BUD_STATUS_LABELS[s]}</option>`).join('')}</select>
              <input type="text" data-bud-note="${it.id}" placeholder="Note (e.g. PR link)" value="${escapeHtml(it.assignee_note || '')}">
              <button data-bud-save="${it.id}" class="secondary">Save</button>
            </div>
          </article>`).join('')
        : '<p class="quiet">Nothing queued yet.</p>');
    $$('[data-bud-save]').forEach((b) => b.onclick = async () => {
      const id = b.dataset.budSave;
      const status = root.querySelector(`[data-bud-status-select="${id}"]`)?.value;
      const assignee_note = root.querySelector(`[data-bud-note="${id}"]`)?.value;
      b.disabled = true;
      try {
        await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'bud-queue-update', id, status, assignee_note }) });
        toast('Fix request updated');
      } catch (err) {
        toast(err.message);
      } finally {
        loadBudQueue();
      }
    });
  }

  async function loadSubscriptionsPanel() {
    const d = await ccCall('admin-command-center?action=subscriptions');
    const analytics = await ccCall('admin-command-center?action=subscription-analytics').catch(() => ({ metrics: {} }));
    const m = analytics.metrics || {};
    const c = m.counts || {};
    const s = d.summary || {};
    $('#subscriptionCommandSummary').innerHTML = [
      ['MRR', `$${Number(m.mrr || 0).toFixed(0)}`],
      ['Active', c.active ?? s.active],
      ['Trial', c.trial ?? s.trialing],
      ['Paused', c.paused ?? '—'],
      ['Canceled', c.canceled ?? s.canceled],
      ['Reactivated', c.reactivated ?? '—'],
      ['Churn %', m.churn_percent ?? '—']
    ].map(([a, b]) => `<article class="metric"><small>${a}</small><strong>${escapeHtml(String(b ?? 0))}</strong></article>`).join('');
    if (m.reason_codes && Object.keys(m.reason_codes).length) {
      $('#subscriptionCommandSummary').innerHTML += `<p class="quiet">Exit reason codes: ${Object.entries(m.reason_codes).map(([k, v]) => `${escapeHtml(k)} (${v})`).join(', ')}</p>`;
    }
    $('#subscriptionCommandList').innerHTML = (d.subscriptions || []).map((sub) => `<article class="shop-row"><div><strong>${escapeHtml(sub.shop_name || sub.shop_id)}</strong><small>${escapeHtml(sub.plan_code)} · ${escapeHtml(sub.status)}</small></div><span>${escapeHtml(sub.stripe_customer_id || 'No Stripe ID')}</span><span>${sub.current_period_ends_at ? new Date(sub.current_period_ends_at).toLocaleDateString() : '—'}</span></article>`).join('') || '<p class="quiet">No subscriptions.</p>';
    if ((analytics.recent_events || []).length) {
      $('#subscriptionCommandList').innerHTML += `<h3>Recent subscription audit</h3>${analytics.recent_events.map((e) => `<article class="shop-row"><div><strong>${escapeHtml(e.event_type)}</strong><small>${escapeHtml(e.shop_id)}</small></div><span>${escapeHtml(e.reason_code || '—')}</span><span>${e.at ? new Date(e.at).toLocaleString() : '—'}</span></article>`).join('')}`;
    }
  }

  async function loadAnnouncements() {
    const d = await ccCall('admin-command-center?action=announcements');
    $('#announcementsList').innerHTML = (d.announcements || []).map((a) => `<article class="panel"><h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.body)}</p><p class="quiet">${escapeHtml(a.audience)} · ${escapeHtml(a.kind)}${a.popup ? ' · popup' : ''}</p></article>`).join('') || '<p class="quiet">No announcements yet.</p>';
  }

  async function loadFeatureFlags() {
    const d = await ccCall('admin-command-center?action=feature-flags');
    $('#featureFlagsForm').innerHTML = Object.entries(d.flags || {}).map(([key, enabled]) => `<label class="feature-check"><input type="checkbox" data-flag="${key}" ${enabled ? 'checked' : ''}> ${key.replaceAll('_', ' ')}</label>`).join('');
  }

  async function loadAnalytics() {
    const d = await ccCall('admin-command-center?action=analytics');
    $('#analyticsPanels').innerHTML = `
      ${chartBars(d.revenue_by_month || [], 'Revenue by month')}
      ${chartBars(d.customer_growth || [], 'Customer growth')}
      ${chartBars(d.marketplace_growth || [], 'Marketplace growth')}
      <article class="panel"><h3>Top products</h3><ul>${(d.top_products || []).map((p) => `<li>${escapeHtml(p.product_name || p.id)}</li>`).join('') || '<li>No data</li>'}</ul><p class="quiet">${escapeHtml(d.ai_usage_note || '')}</p></article>`;
  }

  async function loadBetaToolkit() {
    const mount = $('#betaToolkitPanel');
    if (!mount) return;
    mount.innerHTML = '<p class="quiet">Loading beta toolkit…</p>';
    const d = await ccCall('admin-command-center?action=beta-toolkit');
    const v = d.version || {};
    const mig = (d.migrations || [])
      .map(
        (m) =>
          `<tr><td>${escapeHtml(m.file)}</td><td><span class="badge ${m.status === 'applied' ? 'good' : 'warn'}">${escapeHtml(m.status)}</span></td></tr>`
      )
      .join('');
    const issues = (d.known_issues || [])
      .map((i) => `<article class="shop-row beta-toolkit-row"><div><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(i.severity)}</small><p>${escapeHtml(i.detail)}</p></div></article>`)
      .join('');
    const inbox = (d.feedback || [])
      .map(
        (f) =>
          `<article class="shop-row beta-toolkit-row"><div><strong>${escapeHtml(f.category)}</strong><small>${new Date(f.created_at).toLocaleString()} · shop ${escapeHtml(f.shop_id || '—')}</small><p>${escapeHtml(f.message)}</p></div></article>`
      )
      .join('');
    const stored = readBetaChecks();
    const checks = (d.checklist || [])
      .map(
        (c) =>
          `<label class="feature-check"><input type="checkbox" data-beta-check="${c.id}" ${stored[c.id] ? 'checked' : ''}> ${escapeHtml(c.area)}: ${escapeHtml(c.item)}</label>`
      )
      .join('');
    mount.innerHTML = `
      <h2>${escapeHtml(v.label || 'Florisyn RC1')}</h2>
      <p class="quiet">Code ${escapeHtml(v.code || '')} · Branch ${escapeHtml(v.branch || '')} · Schema ${escapeHtml(d.database?.schema_tag || '')} · Migrations ${d.database?.migrations_applied ?? 0}/${(d.migrations || []).length}</p>
      <h3>Beta checklist</h3><div class="check-grid">${checks}</div>
      <h3>Migration status</h3><table class="audit-table"><thead><tr><th>File</th><th>Status</th></tr></thead><tbody>${mig}</tbody></table>
      <h3>Known issues</h3><div class="shop-list">${issues || '<p class="quiet">None documented.</p>'}</div>
      <h3>Feedback inbox</h3><div class="shop-list">${inbox || '<p class="quiet">No feedback yet.</p>'}</div>`;
    $$('[data-beta-check]').forEach((input) => {
      input.onchange = () => {
        const next = readBetaChecks();
        next[input.dataset.betaCheck] = input.checked;
        localStorage.setItem('bloom_beta_readiness_checks', JSON.stringify(next));
      };
    });
  }

  async function loadSystemHealth() {
    const [healthRes, betaRes] = await Promise.all([
      ccCall('admin-command-center?action=system-health'),
      ccCall('admin-command-center?action=beta-readiness').catch(() => null)
    ]);
    const h = healthRes.health || {};
    const rows = Object.entries(h)
      .filter(([k]) => !Array.isArray(h[k]))
      .map(([k, v]) => `<div class="health-row"><span>${k.replaceAll('_', ' ')}</span><strong class="${v === 'ok' ? 'ok' : 'warn'}">${escapeHtml(String(v))}</strong></div>`)
      .join('');
    const errors = healthRes.recent_errors || { total: 0, shops_affected: 0, by_type: {}, top_paths: [], recent: [] };
    const errorTypeSummary = Object.entries(errors.by_type || {})
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `<span class="badge warn">${escapeHtml(type)}: ${count}</span>`)
      .join(' ');
    const errorTopPaths = (errors.top_paths || [])
      .map((p) => `<li><strong>${p.count}×</strong> ${escapeHtml(p.path)}</li>`)
      .join('');
    const errorRecent = (errors.recent || []).slice(0, 10)
      .map((e) => `<div class="audit-item"><span>${new Date(e.at).toLocaleString()}</span><strong>${escapeHtml(e.type)}${e.status ? ` · ${e.status}` : ''}</strong><code>${escapeHtml(e.path || '')} ${escapeHtml(e.message || '')}</code></div>`)
      .join('');
    const errorPanel = `
      <h3>Client errors — last 7 days</h3>
      ${errors.total
        ? `<p class="quiet">${errors.total} error${errors.total === 1 ? '' : 's'} across ${errors.shops_affected} shop${errors.shops_affected === 1 ? '' : 's'}. Catching this here — before a florist has to file a ticket about it — is the point.</p>
           ${errorTypeSummary ? `<p>${errorTypeSummary}</p>` : ''}
           ${errorTopPaths ? `<h4>Most-hit pages</h4><ul>${errorTopPaths}</ul>` : ''}
           <h4>Most recent</h4>
           ${errorRecent}`
        : `<p class="quiet ok">No client errors reported in the last 7 days.</p>`}
    `;
    const warnings = (betaRes?.config?.warnings || [])
      .map((w) => `<li>${escapeHtml(w)}</li>`)
      .join('');
    const checklist = (betaRes?.checklist || [])
      .map((c) => `<li><strong>${escapeHtml(c.area)}</strong> — ${escapeHtml(c.item)}</li>`)
      .join('');
    const stored = readBetaChecks();
    const checks = (betaRes?.checklist || [])
      .map(
        (c) =>
          `<label class="feature-check"><input type="checkbox" data-beta-check="${c.id}" ${stored[c.id] ? 'checked' : ''}> ${escapeHtml(c.area)}: ${escapeHtml(c.item)}</label>`
      )
      .join('');
    $('#systemHealthPanel').innerHTML = `
      <h2>System health</h2>${rows}
      ${errorPanel}
      ${warnings ? `<h3>Configuration warnings</h3><ul>${warnings}</ul>` : ''}
      <h3>Beta readiness checklist</h3>
      <p class="quiet">Track manual QA before inviting florists. Saved in this browser only.</p>
      <div class="check-grid">${checks || checklist}</div>
      <p class="quiet">${escapeHtml(betaRes?.tests?.command || 'node --test tests/*.test.js')}</p>`;
    $$('[data-beta-check]').forEach((input) => {
      input.onchange = () => {
        const next = readBetaChecks();
        next[input.dataset.betaCheck] = input.checked;
        localStorage.setItem('bloom_beta_readiness_checks', JSON.stringify(next));
      };
    });
  }

  async function loadAuditLog() {
    const filter = encodeURIComponent($('#auditFilter')?.value || '');
    const d = await ccCall(`admin-command-center?action=audit-log&filter=${filter}`);
    $('#platformAuditList').innerHTML = (d.audit || []).map((row) => `<div class="audit-item"><span>${new Date(row.timestamp).toLocaleString()}</span><strong>${escapeHtml(row.action)}</strong><code>${escapeHtml(row.target_type || '')} ${escapeHtml(row.target_id || '')} · ${escapeHtml(row.result)} · ${escapeHtml(row.ip_placeholder)}</code></div>`).join('') || '<p class="quiet">No audit entries.</p>';
  }

  async function loadPaymentOperations() {
    const mount = $('#paymentHubAdminPanel');
    const d = await ccCall('admin-command-center?action=payment-operations');
    const saas = d.bloom_technologies_saas || {};
    const florist = d.florist_customer_payments || {};
    const ops = d.operations || {};
    mount.innerHTML = `<h2>Payment operations</h2>
      <p class="quiet"><strong>A.</strong> ${escapeHtml(saas.label || 'Florisyn SaaS')}</p>
      <div class="metric-grid">
        <article class="metric-box"><span>Florisyn subs (active)</span><strong>${saas.active_bloom_subscribers ?? 0}</strong></article>
        <article class="metric-box"><span>SaaS revenue (month)</span><strong>$${Number(saas.subscription_revenue_month || 0).toFixed(2)}</strong></article>
        <article class="metric-box"><span>Failed SaaS payments</span><strong>${saas.failed_bloom_subscription_payments ?? 0}</strong></article>
      </div>
      <p class="quiet"><strong>B.</strong> ${escapeHtml(florist.label || 'Florist customer payments')}</p>
      <div class="metric-grid">
        <article class="metric-box"><span>Florist volume (today)</span><strong>$${Number(florist.volume_today || 0).toFixed(2)}</strong></article>
        <article class="metric-box"><span>Flower recurring (active)</span><strong>$${Number(florist.customer_recurring_flower_revenue || 0).toFixed(2)}</strong></article>
        <article class="metric-box"><span>Link conversion</span><strong>${florist.payment_link_conversion_rate ?? '—'}%</strong></article>
        <article class="metric-box"><span>Recovery success</span><strong>${florist.recovery_success_rate ?? '—'}%</strong></article>
      </div>
      <div class="metric-grid">
        <article class="metric-box"><span>Webhook failures</span><strong>${ops.webhook_failures ?? 0}</strong></article>
        <article class="metric-box"><span>Email</span><strong>${escapeHtml(ops.notification_email || '—')}</strong></article>
        <article class="metric-box"><span>SMS</span><strong>${escapeHtml(ops.notification_sms || '—')}</strong></article>
        <article class="metric-box"><span>Runs needing attention</span><strong>${ops.recurring_runs_needing_attention ?? 0}</strong></article>
      </div>`;
  }

  async function loadPaymentHubAdmin() {
    await loadPaymentOperations();
  }

  const loaders = {
    overview: loadExecutiveDashboard,
    betaToolkit: loadBetaToolkit,
    users: loadUsers,
    marketplaceAdmin: loadMarketplaceAdmin,
    support: loadSupport,
    subscriptions: loadSubscriptionsPanel,
    announcements: loadAnnouncements,
    featureFlags: loadFeatureFlags,
    analytics: loadAnalytics,
    paymentHub: loadPaymentHubAdmin,
    systemHealth: loadSystemHealth,
    auditLog: loadAuditLog
  };

  window.__loadCommandView = (name) => {
    const fn = loaders[name];
    if (fn) fn().catch((err) => toast(err.message));
  };

  $('#userSearch')?.addEventListener('input', () => clearTimeout(window.userSearchTimer) || (window.userSearchTimer = setTimeout(loadUsers, 300)));
  $('#userRoleFilter')?.addEventListener('change', loadUsers);
  $('#auditFilter')?.addEventListener('input', () => clearTimeout(window.auditTimer) || (window.auditTimer = setTimeout(loadAuditLog, 300)));

  $('#announcementForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await ccCall('admin-command-center', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create-announcement',
        title: fd.get('title'),
        body: fd.get('body'),
        audience: fd.get('audience'),
        kind: fd.get('kind'),
        popup: fd.get('popup') === 'on'
      })
    });
    toast('Announcement created');
    e.currentTarget.reset();
    loadAnnouncements();
  });

  $('#saveFeatureFlags')?.addEventListener('click', async () => {
    const flags = {};
    $$('[data-flag]').forEach((el) => {
      flags[el.dataset.flag] = el.checked;
    });
    await ccCall('admin-command-center', { method: 'POST', body: JSON.stringify({ action: 'save-feature-flags', flags }) });
    toast('Feature flags saved');
  });

  return { loadExecutiveDashboard };
}
