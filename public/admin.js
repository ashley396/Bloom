import { initCommandCenter } from './admin-command-center-ui.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function readAdminSession(){try{return JSON.parse(localStorage.getItem('bloom_admin_session')||'null')}catch{localStorage.removeItem('bloom_admin_session');return null}}
let session=readAdminSession(),selectedShop=null,selectedData=null,commandCenter=null;
const FEATURES=['dashboard','orders','deliveries','customers','inventory','products','bloomshot','website','library','invoices','payments','expenses','reports','staff','marketplace','stores','lily','rose'];
const DEFAULT_NAV=['dashboardPage','ordersPage','deliveriesPage','customersPage','inventoryPage','productsPage','bloomshotPage','websitePage','libraryPage','invoicesPage','paymentsPage','expensesPage','reportsPage','staffPage','marketplacePage','storesPage','settingsPage'];
function toast(t){const x=$('#adminToast');x.textContent=t;x.hidden=false;setTimeout(()=>x.hidden=true,2800)}
async function call(path,opt={},auth=true){const headers={'Content-Type':'application/json',...(opt.headers||{})};if(auth&&session?.accessToken)headers.Authorization=`Bearer ${session.accessToken}`;const r=await fetch(`/.netlify/functions/${path}`,{...opt,headers});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`Request failed (${r.status})`);return d}
function saveSession(d){session={accessToken:d.accessToken,refreshToken:d.refreshToken,user:d.user};localStorage.setItem('bloom_admin_session',JSON.stringify(session))}
function showApp(){ $('#adminAuth').hidden=true;$('#adminApp').hidden=false;$('#adminIdentity').textContent=session.user.email;commandCenter=initCommandCenter({call,toast,escapeHtml,$,$$,setView});loadOverview();if(window.__loadCommandView)window.__loadCommandView('overview');loadShops();window.BloomLaunchPolish?.init?.({mode:'admin',api:call});window.BloomLilyPlatform?.init?.({mode:'admin',api:call,toast})}
async function initializeAdmin(){
  try{
    const d=await call('admin-bootstrap',{},false);
    if(!d.ownerExists){$('#ownerSetup').hidden=false;$('#adminAuth').hidden=true;$('#adminApp').hidden=true;return}
    $('#ownerSetup').hidden=true;
    if($('#loginMessage'))$('#loginMessage').textContent='Owner account exists. Sign in to Florisyn HQ.';
    if(session){
      call('admin-command-center?action=dashboard').then(showApp).catch(()=>{localStorage.removeItem('bloom_admin_session');$('#adminAuth').hidden=false});
    }else $('#adminAuth').hidden=false;
  }catch(err){$('#adminAuth').hidden=false;$('#loginMessage').textContent=err.message}
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
    setTimeout(()=>{$('#ownerSetup').hidden=true;$('#adminAuth').hidden=false},700);
  }catch(err){msg.textContent=err.message}
});
$('#adminLogin').onsubmit=async e=>{e.preventDefault();const loginMessage=$('#loginMessage'),email=$('#adminEmail').value;loginMessage.textContent='';try{const d=await call('auth-login',{method:'POST',body:JSON.stringify({email,password:$('#adminPassword').value})},false);saveSession(d);await call('admin-command-center?action=dashboard');showApp()}catch(err){const detail=String(err.message||'');if(/invalid login credentials|invalid email or password|email not confirmed/i.test(detail)){loginMessage.innerHTML=`Could not sign in yet. Check your email confirmation link, or <a href="/verify-email?pending=1&email=${encodeURIComponent(email)}">resend the confirmation email</a>.`;}else loginMessage.textContent=detail}}
$('#adminLogout').onclick=()=>{localStorage.removeItem('bloom_admin_session');location.reload()}
$$('nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
function setView(name){
  $$('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $$('.view').forEach(v=>v.classList.toggle('active',v.id===`${name}View`));
  const titles={
    overview:'Executive dashboard',betaToolkit:'Beta toolkit — RC1',users:'User management',marketplaceAdmin:'Marketplace admin',support:'Support center',subscriptions:'Subscriptions',announcements:'Announcements',featureFlags:'Feature flags',analytics:'Analytics',paymentHub:'Payment platform',systemHealth:'System health',shops:'Florist accounts',editor:'Remote account editor',auditLog:'Audit log',floralLibraryAdmin:'Floral Library import & quality',audit:'Shop change history'
  };
  $('#viewTitle').textContent=titles[name]||name;
  if(window.__loadCommandView)window.__loadCommandView(name);
  if(name==='floralLibraryAdmin')window.BloomLibraryAdmin?.mount?.(document.getElementById('floralLibraryAdminRoot'));
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
function fillEditor(){const {shop,config={},subscription={}}=selectedData;$('#emptyEditor').hidden=true;$('#shopEditor').hidden=false;$('#editingShopName').textContent=shop.name;$('#editingShopId').textContent=shop.id;['name','email','phone','website','address_line_1','city','state','postal_code','tax_rate','default_delivery_fee'].forEach(k=>val(k,shop[k]));const t=config.theme||{};val('primary',t.primary||'#547428');val('accent',t.accent||'#e94178');val('background',t.background||'#fbf8f6');val('sidebar',t.sidebar||'#ffffff');val('radius',t.radius||18);val('density',t.density||'comfortable');val('announcement',config.announcement);val('support_message',config.support_message);val('nav_order',(config.navigation?.order||DEFAULT_NAV).join('\n'));val('nav_hidden',(config.navigation?.hidden||[]).join(', '));val('plan_code',subscription.plan_code||'trial');val('subscription_status',subscription.status||'trialing');val('trial_ends_at',isoLocal(subscription.trial_ends_at));val('current_period_ends_at',isoLocal(subscription.current_period_ends_at));val('cancel_at_period_end',subscription.cancel_at_period_end);val('account_status',config.account_status||'active');$('#featureChecks').innerHTML=FEATURES.map(f=>`<label class="feature-check"><input type="checkbox" data-feature="${f}" ${(config.features?.[f]??true)?'checked':''}> ${f[0].toUpperCase()+f.slice(1)}</label>`).join('');renderPreview();renderAudit()}
$$('.editor-tabs button').forEach(b=>b.onclick=()=>{$$('.editor-tabs button').forEach(x=>x.classList.toggle('active',x===b));$$('.editor-tab').forEach(p=>p.classList.toggle('active',p.dataset.panel===b.dataset.tab))});
function shopPayload(){const out={};['name','email','phone','website','address_line_1','city','state','postal_code','tax_rate','default_delivery_fee'].forEach(k=>out[k]=$(`[name="${k}"]`).value);return out}
$('#saveShop').onclick=async()=>{const d=await call('admin-console',{method:'POST',body:JSON.stringify({action:'update-shop',shopId:selectedShop,shop:shopPayload()})});selectedData.shop=d.shop;toast('Account details saved');loadShops()}
function configPayload(){const features={};$$('[data-feature]').forEach(x=>features[x.dataset.feature]=x.checked);return{action:'save-config',shopId:selectedShop,accountStatus:$('[name="account_status"]').value,supportMessage:$('[name="support_message"]').value,announcement:$('[name="announcement"]').value,theme:{primary:$('[name="primary"]').value,accent:$('[name="accent"]').value,background:$('[name="background"]').value,sidebar:$('[name="sidebar"]').value,radius:Number($('[name="radius"]').value),density:$('[name="density"]').value},navigation:{order:$('[name="nav_order"]').value.split(/\n+/).map(x=>x.trim()).filter(Boolean),hidden:$('[name="nav_hidden"]').value.split(',').map(x=>x.trim()).filter(Boolean)},features,content:selectedData.config?.content||{}}}
$$('.saveConfig').forEach(b=>b.onclick=async()=>{const d=await call('admin-console',{method:'POST',body:JSON.stringify(configPayload())});selectedData.config=d.config;toast('Remote account configuration saved');renderPreview()});
$('#saveSubscription').onclick=async()=>{await call('admin-console',{method:'POST',body:JSON.stringify({action:'save-config',shopId:selectedShop,...configPayload(),accountStatus:$('[name="account_status"]').value})});const sub={plan_code:$('[name="plan_code"]').value,status:$('[name="subscription_status"]').value,trial_ends_at:$('[name="trial_ends_at"]').value?new Date($('[name="trial_ends_at"]').value).toISOString():null,current_period_ends_at:$('[name="current_period_ends_at"]').value?new Date($('[name="current_period_ends_at"]').value).toISOString():null,cancel_at_period_end:$('[name="cancel_at_period_end"]').checked};const d=await call('admin-console',{method:'POST',body:JSON.stringify({action:'update-subscription',shopId:selectedShop,subscription:sub})});selectedData.subscription=d.subscription;toast('Subscription and account access saved');loadShops()}
function renderPreview(){const p=$('.theme-preview');if(!p)return;p.style.setProperty('--preview-primary',$('[name="primary"]').value);p.style.setProperty('--preview-bg',$('[name="background"]').value);p.style.setProperty('--preview-sidebar',$('[name="sidebar"]').value)}$$('[name="primary"],[name="background"],[name="sidebar"]').forEach(x=>x.oninput=renderPreview);
function renderAudit(){const a=selectedData?.audit||[];$('#auditList').innerHTML=a.length?a.map(x=>`<div class="audit-item"><span>${new Date(x.created_at).toLocaleString()}</span><strong>${x.action.replaceAll('_',' ')}</strong><code>${JSON.stringify(x.details)}</code></div>`).join(''):'<p>No admin changes recorded for this account.</p>'}
$('#previewCustomer').onclick=()=>window.open('/','_blank');
initializeAdmin();
