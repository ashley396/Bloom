-- Runs inside the P0-13 rollback transaction before the app migration chain.
-- Users are synthetic and disappear with the final rollback.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p013-manager@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p013-onboarding@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
