# Bloom authentication branding (dev / redesign-v22)

Unified sign-in, signup, forgot-password, and email verification using `public/bloom-auth.css`.

## Local test (before live Netlify)

```bash
netlify dev
```

Open:

- http://localhost:8888/login
- http://localhost:8888/signup
- http://localhost:8888/forgot-password
- http://localhost:8888/verify-email?pending=1
- http://localhost:8888/verify-email?confirmed=1

Check mobile width (~390px): no clipped labels, 48px tap targets, hero stacks above form.

## Assets

- Hero: `public/assets/auth/luxury-florist-workspace.jpg` (licensed Pexels — replace with owned photography for production)
- Logo mark: `assets/bloom-mark.svg`
- Favicon: `assets/bloom-favicon.svg`
- App icon: `assets/bloom-icon.svg` (aligned with flower mark)

## Live site

Do **not** change production Netlify until founder sign-off on dev/preview deploy.

## Automated tests

`node --test tests/bloom-auth-branding.test.js`
