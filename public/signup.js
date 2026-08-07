const $=s=>document.querySelector(s);
const authClient=window.FlorisynAuthClient;
async function api(path,opt={}){
  const base=path.startsWith("auth-")?`/api/${path}`:`/.netlify/functions/${path}`;
  if(path.startsWith("auth-") && authClient?.postAuth && (opt.method||"GET").toUpperCase()==="POST"){
    const body=opt.body?JSON.parse(opt.body):{};
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
$('#signupForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const button=e.submitter,message=$('#signupMessage');
  message.textContent='';
  button.disabled=true;
  button.textContent='Creating your Florisyn account…';
  try{
    const plan=document.querySelector('input[name="plan"]:checked');
    const payload={
      fullName:$('#fullName').value.trim(),
      shopName:$('#shopName').value.trim(),
      email:$('#email').value.trim(),
      password:$('#password').value,
      businessPhone:$('#businessPhone').value.trim(),
      businessType:$('#businessType').value,
      businessAddress:$('#businessAddress').value.trim(),
      businessCity:$('#businessCity').value.trim(),
      businessState:$('#businessState').value.trim().toUpperCase(),
      businessZip:$('#businessZip').value.trim(),
      planCode:plan.value,
      subscriptionPrice:Number(plan.dataset.price)
    };
    const d=await api('auth-signup',{method:'POST',body:JSON.stringify(payload)});
    if(d.confirmationRequired){
      sessionStorage.setItem('florisyn_pending_email',payload.email);
      if(d.confirmationEmailSent===false){
        sessionStorage.setItem('florisyn_pending_email_hint','We created your account, but the confirmation email may be delayed. Use Resend on the next page if needed.');
      }
      location.href=`/verify-email?pending=1&email=${encodeURIComponent(payload.email)}`;
      return;
    }
    if(d.accessToken){
      localStorage.setItem('bloom_session',JSON.stringify({accessToken:d.accessToken,refreshToken:d.refreshToken,user:d.user}));
      location.href='/';
    }else location.href='/?account=created';
  }catch(err){
    if(err.code==='auth_rate_limited'){
      message.textContent=authClient?.rateLimitMessage?.(err.retryAfterSeconds, err.message) || err.message;
    }else{
      message.textContent=err.message;
    }
    button.disabled=false;
    button.textContent='Start my free trial';
  }
});
