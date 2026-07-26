// Floravia SaaS onboarding module.
// Add `await floraviaSaasAfterLogin();` before your normal dashboard load.

let floraviaOnboardingStep = 1;

function floraviaShowStep(step) {
  floraviaOnboardingStep = Math.max(1, Math.min(4, step));
  document.querySelectorAll(".onboarding-step").forEach((el) => {
    el.classList.toggle("active", Number(el.dataset.step) === floraviaOnboardingStep);
  });
  document.querySelector("#onboardingBack").hidden = floraviaOnboardingStep === 1;
  document.querySelector("#onboardingNext").hidden = floraviaOnboardingStep === 4;
  document.querySelector("#onboardingFinish").hidden = floraviaOnboardingStep !== 4;
  document.querySelector("#onboardingProgress").style.width = `${floraviaOnboardingStep * 25}%`;
}

function floraviaCurrentStepValid() {
  const section = document.querySelector(`.onboarding-step[data-step="${floraviaOnboardingStep}"]`);
  return [...section.querySelectorAll("input,select,textarea")].every((field) => !field.required || field.reportValidity());
}

async function floraviaSaasAfterLogin() {
  const status = await api("onboarding-status");
  window.floraviaAccount = status;

  if (status.needsOnboarding) {
    const form = document.querySelector("#floraviaOnboardingForm");
    if (status.user?.fullName) form.elements.fullName.value = status.user.fullName;
    if (status.user?.email) form.elements.email.value = status.user.email;
    floraviaShowStep(1);
    document.querySelector("#floraviaOnboarding").showModal();
    return false;
  }

  document.documentElement.dataset.subscription = status.subscription?.status || "unknown";
  document.documentElement.dataset.plan = status.subscription?.plan_code || "trial";
  return true;
}

document.querySelector("#onboardingNext")?.addEventListener("click", () => {
  if (floraviaCurrentStepValid()) floraviaShowStep(floraviaOnboardingStep + 1);
});
document.querySelector("#onboardingBack")?.addEventListener("click", () => floraviaShowStep(floraviaOnboardingStep - 1));

document.querySelector("#floraviaOnboardingForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.querySelector("#onboardingMessage");
  message.textContent = "";
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    await api("complete-onboarding", { method: "POST", body: JSON.stringify(payload) });
    document.querySelector("#floraviaOnboarding").close();
    toast("Your flower shop is ready");
    await loadDashboard();
  } catch (error) {
    message.textContent = error.message;
  }
});

async function chooseFloraviaPlan(planCode) {
  const result = await api("create-subscription-checkout", {
    method: "POST",
    body: JSON.stringify({ planCode })
  });
  location.href = result.url;
}
window.chooseFloraviaPlan = chooseFloraviaPlan;
window.floraviaSaasAfterLogin = floraviaSaasAfterLogin;
