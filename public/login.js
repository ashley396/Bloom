const form=document.querySelector('#authForm');
const message=document.querySelector('#authMessage');
const button=document.querySelector('#authButton');

async function bloomLogin(event){
  event.preventDefault();
  event.stopImmediatePropagation();
  if(!form || form.dataset.submitting==='true') return;
  const email=document.querySelector('#email')?.value.trim();
  const password=document.querySelector('#password')?.value || '';
  message.textContent='';
  if(!email || !password){ message.textContent='Enter your business email and password.'; return; }
  form.dataset.submitting='true';
  button.disabled=true;
  button.textContent='Signing in…';
  try{
    const response=await fetch('/.netlify/functions/auth-login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email,password})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || `Sign in failed (${response.status})`);
    const session={accessToken:data.accessToken,refreshToken:data.refreshToken,user:data.user,expiresAt:data.expiresIn?Date.now()+Number(data.expiresIn)*1000:null};
    localStorage.setItem('bloom_session',JSON.stringify(session));
    window.dispatchEvent(new CustomEvent('bloom-login-success',{detail:session}));
    location.href="/";
  }catch(error){
    const detail=String(error.message||'');
    if(/invalid login credentials|email not confirmed/i.test(detail)){
      const emailParam=encodeURIComponent(email||'');
      message.innerHTML=`Could not sign in yet. Check your email confirmation link, or <a href="/verify-email?pending=1&email=${emailParam}">resend the confirmation email</a>.`;
    }else{
      message.textContent=detail || 'Sign in failed. Please try again.';
    }
    form.dataset.submitting='false';
    button.disabled=false;
    button.textContent='Sign in';
  }
}
form?.addEventListener('submit',bloomLogin,{capture:true});
