import { initCommandCenter } from './admin-command-center-ui.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function readAdminSession(){try{return JSON.parse(localStorage.getItem('bloom_admin_session')||'null')}catch{localStorage.removeItem('bloom_admin_session');return null}}
let session=readAdminSession(),selectedShop=null,selectedData=null,commandCenter=null;
const FEATURES=['dashboard','orders','deliveries','customers','inventory','products','bloomshot','website','library','invoices','payments','expenses','reports','staff','marketplace','stores','lily','rose'];
const DEFAULT_NAV=['dashboardPage','ordersPage','deliveriesPage','customersPage','inventoryPage','productsPage','bloomshotPage','websitePage','libraryPage','invoicesPage','paymentsPage','expensesPage','reportsPage','staffPage','marketplacePage','storesPage','settingsPage'];
function toast(t){const x=$('#adminToast');if(!x)return;x.textContent=t;x.hidden=false;setTimeout(()=>x.hidden=true,2800)}
async function call(path,opt={},auth=true){const headers={'Content-Type':'application/json',...(opt.headers||{})};if(auth&&session?.accessToken)headers.Authorization=`Bearer ${session.accessToken}`;const base=(String(path).startsWith("auth-")&&!String(path).startsWith("auth-refresh")&&!String(path).startsWith("auth-resend"))?`/api/${path}`:`/.netlify/functions/${path}`;const r=await fetch(base,{...opt,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}
function saveSession(d){session={accessToken:d.accessToken,refreshToken:d.refreshToken,user:d.user};localStorage.setItem('bloom_admin_session',JSON.stringify(session))}
function clearAdminSession(){session=null;localStorage.removeItem('bloom_admin_session')}
function lockAdminShell(){
  document.body.classList.add('admin-locked');
  document.body.classList.remove('admin-authenticated');
  const app=$('#adminApp');
  if(app){app.hidden=true;app.setAttribute('aria-hidden','true')}
}
function showLoginGate(){
  lockAdminShell();
  if($('#ownerSetup'))$('#ownerSetup').hidden=true;
  if($('#adminAuth'))$('#adminAuth').hidden=false;
}
function showOwnerSetupGate(){
  lockAdminShell();
  if($('#adminAuth'))$('#adminAuth').hidden=true;
  if($('#ownerSetup'))$('#ownerSetup').hidden=false;
}
function showApp(){
  if(!session?.accessToken||!session?.user){clearAdminSession();showLoginGate();return false}
  if($('#ownerSetup'))$('#ownerSetup').hidden=true;
  if($('#adminAuth'))$('#adminAuth').hidden=true;
  const app=$('#adminApp');
  if(app){app.hidden=false;app.setAttribute('aria-hidden','false')}
  document.body.classList.remove('admin-locked');
  document.body.classList.add('admin-authenticated');
  if($('#adminIdentity'))$('#adminIdentity').textContent=session.user.email;
  // Reveal shell first; never let post-auth UI init bounce Ashley back to login.
  try{
    commandCenter=initCommandCenter({call,toast,escapeHtml,$,$$,setView});
    Promise.resolve(loadOverview()).catch((err)=>toast(err.message||'Could not load overview'));
    if(window.__loadCommandView)window.__loadCommandView('overview');
    Promise.resolve(loadShops()).catch((err)=>toast(err.message||'Could not load shops'));
    window.BloomLaunchPolish?.init?.({mode:'admin',api:call});
    window.BloomLilyPlatform?.init?.({mode:'admin',api:call,toast});
    document.dispatchEvent(new CustomEvent('florisyn-admin-authenticated'));
  }catch(err){
    console.error(err);
    toast(err?.message||'Admin UI finished signing in, but one panel failed to load');
  }
  return true;
}
async function initializeAdmin(){
  lockAdminShell();
  try{
    const d=await call('admin-bootstrap',{},false);
    if(!d.ownerExists){showOwnerSetupGate();return}
    if($('#loginMessage'))$('#loginMessage').textContent='Owner account exists. Sign in to Florisyn HQ.';
    if(session?.accessToken){
      call('admin-command-center?action=dashboard').then(showApp).catch(()=>{clearAdminSession();showLoginGate()});
    }else showLoginGate();
  }catch(err){
    clearAdminSession();
    showLoginGate();
    if($('#loginMessage'))$('#loginMessage').textContent=err.message;
  }
}
$('#ownerSetupForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=$('#ownerSetupMessage'),password=$('#ownerPassword').value;
  if(password!==$('#ownerPasswordConfirm').value){msg.textContent='The passwords do not match.';return}
  msg.textContent='Creating your secure Owner account…';
  try{
    await call('admin-bootstrap',{method:'POST',body:JSON.stringify({name:$('#ownerName').value,email:$('#ownerEmail').value,password,bootstrapSecret:$('#ownerBootstrapSecret')?.value||''})},false);
    msg.textContent='Owner account created. You can sign in now.';
    $('#adminEmail').value=$('#ownerEmail').value;
    $('#ownerPassword').value='';$('#ownerPasswordConfirm').value='';if($('#ownerBootstrapSecret'))$('#ownerBootstrapSecret').value='';
    setTimeout(showLoginGate,700);
  }catch(err){msg.textContent=err.message}
});
$('#adminPasswordToggle')?.addEventListener('click',()=>{
  const input=$('#adminPassword');
  const toggle=$('#adminPasswordToggle');
  if(!input||!toggle)return;
  const show=input.type==='password';
  input.type=show?'text':'password';
  toggle.setAttribute('aria-pressed',show?'true':'false');
  toggle.setAttribute('aria-label',show?'Hide password':'Show password');
});
$('#adminResetPassword')?.addEventListener('click',async()=>{
  const loginMessage=$('#loginMessage');
  const email=String($('#adminEmail')?.value||'').trim();
  const btn=$('#adminResetPassword');
  if(loginMessage){loginMessage.dataset.userError='1';loginMessage.textContent=''}
  if(!email){
    if(loginMessage)loginMessage.textContent='Enter your Admin email first, then click Reset password.';
    $('#adminEmail')?.focus();
    return;
  }
  if(btn){btn.disabled=true;btn.textContent='Sending reset link…'}
  try{
    const d=await call('auth-forgot-password',{method:'POST',body:JSON.stringify({email})},false);
    if(loginMessage)loginMessage.textContent=d.message||'If an account exists for this email, you will receive password reset instructions shortly.';
    if(btn)btn.textContent='Reset email sent';
  }catch(err){
    if(loginMessage)loginMessage.textContent=err.message||'Could not send reset email. Please try again.';
    if(btn){btn.disabled=false;btn.textContent='Reset password'}
  }
});
$('#adminLogin').onsubmit=async e=>{
  e.preventDefault();
  const loginMessage=$('#loginMessage');
  const email=$('#adminEmail').value;
  if(loginMessage){loginMessage.dataset.userError='1';loginMessage.textContent='Signing in…'}
  try{
    const d=await call('auth-login',{method:'POST',body:JSON.stringify({email,password:$('#adminPassword').value})},false);
    if(!d?.accessToken)throw new Error('Sign in did not return a session. Please try again.');
    saveSession(d);
    await call('admin-command-center?action=dashboard');
    showApp();
  }catch(err){
    clearAdminSession();
    showLoginGate();
    const detail=String(err.message||'');
    if(!loginMessage)return;
    loginMessage.dataset.userError='1';
    if(/invalid login credentials|invalid email or password|email not confirmed/i.test(detail)){
      loginMessage.innerHTML=`Could not sign in yet. Check your password, <button type="button" class="linkish" id="adminResetPasswordHint">reset your password</button>, or <a href="/verify-email?pending=1&email=${encodeURIComponent(email)}">resend the confirmation email</a>.`;
      $('#adminResetPasswordHint')?.addEventListener('click',()=>$('#adminResetPassword')?.click());
    }else if(/permission|forbidden|not have permission|platform admin|administration/i.test(detail)){
      loginMessage.textContent=detail||'This account is not authorized for Florisyn Administration.';
    }else if(/unexpected florisyn error|\.change is not a function/i.test(detail)){
      loginMessage.innerHTML=`Your password was accepted, but Florisyn HQ could not finish loading. Use <button type="button" class="linkish" id="adminResetPasswordHint">Reset password</button> if needed, then try again.`;
      $('#adminResetPasswordHint')?.addEventListener('click',()=>$('#adminResetPassword')?.click());
    }else loginMessage.textContent=detail||'Could not sign in. Please try again.';
  }
}
$('#adminLogout').onclick=()=>{clearAdminSession();location.reload()}
lockAdminShell();
$$('nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
function setView(name){
  $$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`));
  const titles={
    overview:'Executive dashboard',betaToolkit:'Beta toolkit — RC1',users:'User management',marketplaceAdmin:'Marketplace admin',support:'Support center',subscriptions:'Subscriptions',announcements:'Announcements',featureFlags:'Feature flags',analytics:'Analytics',paymentHub:'Payment platform',systemHealth:'System health',shops:'Florist accounts',editor:'Remote account editor',auditLog:'Audit log',floralLibraryAdmin:'Floral Library import & quality',uiDesignMode:'UI Design Mode — visual studio',audit:'Shop change history'
  };
  $('#viewTitle').textContent=titles[name]||name;
  if(window.__loadCommandView)window.__loadCommandView(name);
  if(name==='floralLibraryAdmin')window.BloomLibraryAdmin?.mount?.(document.getElementById('floralLibraryAdminRoot'));
  if(name==='uiDesignMode')window.FlorisynUiEditor?.mountAdminPanel?.(document.getElementById('uiDesignModeRoot'));
}
async function loadOverview(){
  const d=await call('admin-console?action=overview');
  const money=n=>Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
  $('#adminMetrics').innerHTML=[
    ['Florist accounts',d.metrics.shops],
    ['Active subscriptions',d.metrics.activeSubscriptions],
    ['New this month',d.metrics.newThisMonth],
    ['Estimated monthly revenue',money(d.metrics.estimatedMrr)]
  ].map(([a,b])=>`<article class="metric"><small>${a}</small><strong>${typeof b==='number'?Number(b).toLocaleString():b}</strong></article>`).join('');
  if($('#foundationTotal'))$('#foundationTotal').value=Number(d.platform?.foundationTotal||0).toFixed(2);
  $('#subscriptionSnapshot').innerHTML=[
    ['Free trials',d.metrics.trials],
    ['Starter',d.metrics.starter],
    ['Pro',d.metrics.professional],
    ['Premium',d.metrics.premium],
    ['Canceling',d.metrics.canceling],
    ['Canceled this month',d.metrics.canceledThisMonth]
  ].map(([a,b])=>`<div><span>${a}</span><strong>${Number(b||0).toLocaleString()}</strong></div>`).join('');
  const alerts=d.alerts||[];
  $('#subscriberAlerts').innerHTML=alerts.length?alerts.map(a=>`<button class="subscriber-alert ${a.read_at?'':'unread'}" data-alert-shop="${a.shop_id||''}"><span class="alert-dot"></span><div><strong>${escapeHtml(a.title)}</strong><p>${escapeHtml(a.message||'')}</p><small>${new Date(a.created_at).toLocaleString()}</small></div></button>`).join(''):'<p class="quiet">No subscriber activity yet.</p>';
  $$('[data-alert-shop]').forEach(b=>b.onclick=()=>b.dataset.alertShop&&openShop(b.dataset.alertShop));
}
function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

async function loadShops(){const q=encodeURIComponent($('#shopSearch').value||'');const d=await call(`admin-console?action=shops&search=${q}`);$('#shopList').innerHTML=d.shops.length?d.shops.map(s=>{const sub=s.shop_subscriptions?.[0]||{};const cfg=s.shop_admin_config?.[0]||{};return `<article class="shop-row"><div><strong>${s.name}</strong><small>${s.email||s.slug||''}</small></div><span>${s.city||''}${s.state?`, ${s.state}`:''}</span><span class="badge">${sub.plan_code||'trial'}</span><span class="badge ${cfg.account_status==='suspended'?'danger':cfg.account_status==='maintenance'?'warn':''}">${cfg.account_status||'active'}</span><button data-open-shop="${s.id}">Manage</button></article>`}).join(''):'<p>No florist accounts found.</p>';$$('[data-open-shop]').forEach(b=>b.onclick=()=>openShop(b.dataset.openShop))}
$('#saveFoundation')?.addEventListener('click',async()=>{await call('admin-console',{method:'POST',body:JSON.stringify({action:'save-platform-settings',foundationTotal:Number($('#foundationTotal').value||0)})});toast('Rose Foundation amount saved');loadOverview()});
$('#markAlertsRead').onclick=async()=>{await call('admin-console',{method:'POST',body:JSON.stringify({action:'mark-alerts-read'})});toast('Subscriber alerts marked read');loadOverview()};
$('#shopSearch').oninput=()=>{clearTimeout(window.st);window.st=setTimeout(loadShops,350)};$('#refreshAdmin').onclick=()=>{loadOverview();loadShops();if(window.__loadCommandView)window.__loadCommandView($('nav button.active')?.dataset.view||'overview');if(selectedShop)openShop(selectedShop)};
async function openShop(id){selectedShop=id;selectedData=await call(`admin-console?action=shop&shopId=${id}`);fillEditor();setView('editor')}
function val(name,v){const el=$(`[name="${name}"]`);if(!el)return;if(el.type==='checkbox')el.checked=Boolean(v);else el.value=v??''}
function isoLocal(v){if(!v)return'';const d=new Date(v);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function fillEditor(){const {shop,config={},subscription={}}=selectedData;$('#emptyEditor').hidden=true;$('#shopEditor').hidden=false;$('#editingShopName').textContent=shop.name;$('#editingShopId').textContent=shop.id;['name','email','phone','website','address_line_1','city','state','postal_code','tax_rate','default_delivery_fee'].forEach(k=>val(k,shop[k]));const t=config.theme||{};val('primary',t.primary||'#547428');val('accent',t.accent||'#e94178');val('background',t.background||'#fbf8f6');val('sidebar',t.sidebar||'#ffffff');val('radius',t.radius||18);val('density',t.density||'comfortable');val('announcement',config.announcement);val('support_message',config.support_message);val('nav_order',(config.navigation?.order||DEFAULT_NAV).join('\n'));val('nav_hidden',(config.navigation?.hidden||[]).join(', '));const c=config.content||{};val('app_background_image',c.app_background_image||'');val('dashboard_image',c.dashboard_image||'');val('logo_image',c.logo_image||'');val('layout_mode',c.layout_mode||'classic');val('button_labels',JSON.stringify(c.button_labels||{},null,2));val('tab_labels',JSON.stringify(c.tab_labels||{},null,2));val('plan_code',subscription.plan_code||'trial');val('subscription_status',subscription.status||'trialing');val('trial_ends_at',isoLocal(subscription.trial_ends_at));val('current_period_ends_at',isoLocal(subscription.current_period_ends_at));val('cancel_at_period_end',subscription.cancel_at_period_end);val('account_status',config.account_status||'active');$('#featureChecks').innerHTML=FEATURES.map(f=>`<label class="feature-check"><input type="checkbox" data-feature="${f}" ${(config.features?.[f]??true)?'checked':''}> ${f[0].toUpperCase()+f.slice(1)}</label>`).join('');renderPreview();renderAudit()}
$$('.editor-tabs button').forEach(b=>b.onclick=()=>{$$('.editor-tabs button').forEach(x=>x.classList.toggle('active',x===b));$$('.editor-tab').forEach(p=>p.classList.toggle('active',p.dataset.panel===b.dataset.tab))});
function shopPayload(){const out={};['name','email','phone','website','address_line_1','city','state','postal_code','tax_rate','default_delivery_fee'].forEach(k=>out[k]=$(`[name="${k}"]`).value);return out}
$('#saveShop').onclick=async()=>{const d=await call('admin-console',{method:'POST',body:JSON.stringify({action:'update-shop',shopId:selectedShop,shop:shopPayload()})});selectedData.shop=d.shop;toast('Account details saved');loadShops()}
function parseJsonField(name){const raw=$(`[name="${name}"]`)?.value?.trim()||'';if(!raw)return{};try{const parsed=JSON.parse(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('object required');return parsed}catch{throw new Error(`${name.replaceAll('_',' ')} must be valid JSON object text.`)}}
function configPayload(){const features={};$$('[data-feature]').forEach(x=>features[x.dataset.feature]=x.checked);return{action:'save-config',shopId:selectedShop,accountStatus:$('[name="account_status"]').value,supportMessage:$('[name="support_message"]').value,announcement:$('[name="announcement"]').value,theme:{primary:$('[name="primary"]').value,accent:$('[name="accent"]').value,background:$('[name="background"]').value,sidebar:$('[name="sidebar"]').value,radius:Number($('[name="radius"]').value),density:$('[name="density"]').value},navigation:{order:$('[name="nav_order"]').value.split(/\n+/).map(x=>x.trim()).filter(Boolean),hidden:$('[name="nav_hidden"]').value.split(',').map(x=>x.trim()).filter(Boolean)},features,content:{app_background_image:$('[name="app_background_image"]')?.value.trim()||'',dashboard_image:$('[name="dashboard_image"]')?.value.trim()||'',logo_image:$('[name="logo_image"]')?.value.trim()||'',layout_mode:$('[name="layout_mode"]')?.value||'classic',button_labels:parseJsonField('button_labels'),tab_labels:parseJsonField('tab_labels')}}}
$$('.saveConfig').forEach(b=>b.onclick=async()=>{try{const d=await call('admin-console',{method:'POST',body:JSON.stringify(configPayload())});selectedData.config=d.config;toast('Remote account configuration saved');renderPreview()}catch(err){toast(err.message)}});
$('#saveSubscription').onclick=async()=>{await call('admin-console',{method:'POST',body:JSON.stringify({action:'save-config',shopId:selectedShop,...configPayload(),accountStatus:$('[name="account_status"]').value})});const sub={plan_code:$('[name="plan_code"]').value,status:$('[name="subscription_status"]').value,trial_ends_at:$('[name="trial_ends_at"]').value?new Date($('[name="trial_ends_at"]').value).toISOString():null,current_period_ends_at:$('[name="current_period_ends_at"]').value?new Date($('[name="current_period_ends_at"]').value).toISOString():null,cancel_at_period_end:$('[name="cancel_at_period_end"]').checked};const d=await call('admin-console',{method:'POST',body:JSON.stringify({action:'update-subscription',shopId:selectedShop,subscription:sub})});selectedData.subscription=d.subscription;toast('Subscription and account access saved');loadShops()}
function renderPreview(){const p=$('.theme-preview');if(!p)return;p.style.setProperty('--preview-primary',$('[name="primary"]').value);p.style.setProperty('--preview-bg',$('[name="background"]').value);p.style.setProperty('--preview-sidebar',$('[name="sidebar"]').value)}$$('[name="primary"],[name="background"],[name="sidebar"]').forEach(x=>x.oninput=renderPreview);
function renderAudit(){const a=selectedData?.audit||[];$('#auditList').innerHTML=a.length?a.map(x=>`<div class="audit-item"><span>${new Date(x.created_at).toLocaleString()}</span><strong>${x.action.replaceAll('_',' ')}</strong><code>${JSON.stringify(x.details)}</code></div>`).join(''):'<p>No admin changes recorded for this account.</p>'}
$('#previewCustomer').onclick=()=>window.open('/','_blank','noopener');
$('#editFloristDesign')?.addEventListener('click',()=>window.open('/?florisynDesign=1','_blank','noopener'));
$('#editFloristImages')?.addEventListener('click',()=>window.open('/?florisynImageEdit=1','_blank','noopener'));
initializeAdmin();
