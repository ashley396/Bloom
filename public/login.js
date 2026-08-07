const form=document.querySelector('#authForm');
const message=document.querySelector('#authMessage');
const button=document.querySelector('#authButton');
const authClient=window.FlorisynAuthClient;

function setLoginMessage(text, { html = false } = {}){
  if(!message) return;
  if(html) message.innerHTML=text;
  else message.textContent=text;
}

async function bloomLogin(event){
  event.preventDefault();
  event.stopImmediatePropagation();
  if(!form || form.dataset.submitting==='true') return;
  const email=document.querySelector('#email')?.value.trim();
  const password=document.querySelector('#password')?.value || '';
  setLoginMessage('');
  if(!email || !password){ setLoginMessage('Enter your business email and password.'); return; }
  if(!authClient?.postAuth){
    setLoginMessage('Sign-in is temporarily unavailable. Please refresh the page and try again.');
    return;
  }
  form.dataset.submitting='true';
  if(button) button.disabled=true;
  const originalLabel=button?.textContent;
  if(button) button.textContent='Signing in…';
  try{
    const {response,data,retryAfterSeconds}=await authClient.postAuth('/api/auth-login',{email,password});
    if(!response.ok){
      const err=new Error(data.error || `Sign in failed (${response.status})`);
      err.code=data.code||'';
      err.status=response.status;
      err.retryAfterSeconds=retryAfterSeconds;
      throw err;
    }
    const session={accessToken:data.accessToken,refreshToken:data.refreshToken,user:data.user,expiresAt:data.expiresIn?Date.now()+Number(data.expiresIn)*1000:null};
    localStorage.setItem('bloom_session',JSON.stringify(session));
    window.dispatchEvent(new CustomEvent('bloom-login-success',{detail:session}));
    location.href="/";
  }catch(error){
    const detail=String(error.message||'');
    const code=String(error.code||'');
    const emailParam=encodeURIComponent(email||'');
    if(code==='shop_membership_required'||/not linked to an active flower shop/i.test(detail)){
      setLoginMessage(detail);
    }else if(code==='email_not_confirmed'||/email not confirmed/i.test(detail)){
      setLoginMessage(`Could not sign in yet. Check your email confirmation link, or <a href="/verify-email?pending=1&email=${emailParam}">resend the confirmation email</a>.`, { html:true });
    }else if(code==='auth_rate_limited'||responseStatusIs429(error)){
      setLoginMessage(authClient?.rateLimitMessage?.(error.retryAfterSeconds, detail) || detail || 'Too many attempts. Please wait and try again.');
    }else if(code==='auth_email_provider_unavailable'||code==='membership_check_unavailable'||code==='upstream_timeout'){
      setLoginMessage(detail || 'Sign in is temporarily unavailable. Please try again shortly.');
    }else if(code==='invalid_credentials'||/invalid login credentials|invalid email or password|email not confirmed/i.test(detail)){
      setLoginMessage(`Could not sign in. Check your email and password, or <a href="/forgot-password">reset your password</a>. Need to confirm your email? <a href="/verify-email?pending=1&email=${emailParam}">Resend confirmation</a>.`, { html:true });
    }else{
      setLoginMessage(detail || 'Sign in failed. Please try again.');
    }
    form.dataset.submitting='false';
    if(button){
      button.disabled=false;
      button.textContent=originalLabel || 'Sign in';
    }
  }
}
function responseStatusIs429(error){return Number(error?.retryAfterSeconds)>0 || Number(error?.status)===429}
form?.addEventListener('submit',bloomLogin,{capture:true});
