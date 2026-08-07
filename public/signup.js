const $=s=>document.querySelector(s);
const authClient=window.FlorisynAuthClient;
async function api(path,opt={}){
  const base=path.startsWith("auth-")?`/api/${path}`:`/.netlify/functions/${path}`;
  if(path.startsWith("auth-") && authClient?.postAuth && (opt.method||"GET").toUpperCase()==="POST"){
    let body={};
    try{ body=opt.body?JSON.parse(opt.body):{}; }catch{ body={}; }
    const {response,data,retryAfterSeconds}=await authClient.postAuth(base,body);
    if(!response.ok){
      const err=new Error(data.error||`Request failed (${response.status})`);
      err.code=data.code||"";
      err.retryAfterSeconds=retryAfterSeconds;
      throw err;
    }
    return data;
  }
  const r=await fetch(base,{...opt,headers:{'Content-Type':'application/json',...(opt.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    const err=new Error(d.error||`Request failed (${r.status})`);
    err.code=d.code||"";
    throw err;
  }
  return d;
}
const signupForm=$('#signupForm');
signupForm?.addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.submitter || $('#signupButton') || signupForm.querySelector('[type="submit"]');
  const message=$('#signupMessage');
  if(message) message.textContent='';
  if(button){
    button.disabled=true;
    button.textContent='Creating your Florisyn account…';
  }
  try{
    if(!authClient?.postAuth){
      throw new Error('Sign-up is temporarily unavailable. Please refresh the page and try again.');
    }
    const plan=document.querySelector('input[name="plan"]:checked');
    const payload={
      fullName:$('#fullName')?.value.trim()||'',
      shopName:$('#shopName')?.value.trim()||'',
      email:$('#email')?.value.trim()||'',
      password:$('#password')?.value||'',
      businessPhone:$('#businessPhone')?.value.trim()||'',
      businessType:$('#businessType')?.value||'',
      businessAddress:$('#businessAddress')?.value.trim()||'',
      businessCity:$('#businessCity')?.value.trim()||'',
      businessState:($('#businessState')?.value.trim()||'').toUpperCase(),
      businessZip:$('#businessZip')?.value.trim()||'',
      planCode:plan?.value||'pro',
      subscriptionPrice:Number(plan?.dataset?.price||79)
    };
    const d=await api('auth-signup',{method:'POST',body:JSON.stringify(payload)});
    // Signup never mints a florist session — confirm email then sign in after shop attachment.
    sessionStorage.setItem('florisyn_pending_email',payload.email);
    if(d.confirmationRequired || d.nextStep==='verify_email'){
      if(d.confirmationEmailSent===false){
        sessionStorage.setItem('florisyn_pending_email_hint','We created your account, but the confirmation email may be delayed. Use Resend on the next page if needed.');
      }
      location.href=`/verify-email?pending=1&email=${encodeURIComponent(payload.email)}`;
      return;
    }
    location.href=`/login?account=created&email=${encodeURIComponent(payload.email)}`;
  }catch(err){
    if(message){
      if(err.code==='auth_rate_limited'){
        message.textContent=authClient?.rateLimitMessage?.(err.retryAfterSeconds, err.message) || err.message;
      }else{
        message.textContent=err.message||'Could not create your account.';
      }
    }
    if(button){
      button.disabled=false;
      button.textContent='Start my free trial';
    }
  }
});
