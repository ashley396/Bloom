-- Bloom v20.6 Subscriber Intelligence -- run once after v20.5
create table if not exists public.platform_admin_notifications (
  id bigint generated always as identity primary key,
  shop_id uuid references public.shops(id) on delete cascade,
  event_type text not null,
  title text not null,
  message text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.platform_admin_notifications enable row level security;

create or replace function public.bloom_subscription_admin_alert()
returns trigger language plpgsql security definer set search_path=public as $$
declare shop_name text; event_name text; headline text; detail text;
begin
  select name into shop_name from public.shops where id=new.shop_id;
  if tg_op='INSERT' then
    event_name := case when new.status='trialing' then 'new_trial' else 'new_subscriber' end;
    headline := case when new.status='trialing' then 'New free trial started' else 'New paid subscriber' end;
    detail := coalesce(shop_name,'A florist') || ' selected the ' || initcap(replace(new.plan_code,'professional','Pro')) || ' plan.';
  elsif old.status is distinct from new.status and new.status='active' then
    event_name:='subscription_activated'; headline:='Trial converted to paid'; detail:=coalesce(shop_name,'A florist') || ' is now an active ' || initcap(replace(new.plan_code,'professional','Pro')) || ' subscriber.';
  elsif old.status is distinct from new.status and new.status='canceled' then
    event_name:='subscription_canceled'; headline:='Subscription canceled'; detail:=coalesce(shop_name,'A florist') || ' canceled their Bloom subscription.';
  elsif old.cancel_at_period_end is distinct from new.cancel_at_period_end and new.cancel_at_period_end then
    event_name:='cancellation_scheduled'; headline:='Cancellation scheduled'; detail:=coalesce(shop_name,'A florist') || ' will cancel at the end of the billing period.';
  elsif old.plan_code is distinct from new.plan_code then
    event_name:='plan_changed'; headline:='Subscription plan changed'; detail:=coalesce(shop_name,'A florist') || ' changed to the ' || initcap(replace(new.plan_code,'professional','Pro')) || ' plan.';
  else return new; end if;
  insert into public.platform_admin_notifications(shop_id,event_type,title,message) values(new.shop_id,event_name,headline,detail);
  return new;
end $$;

drop trigger if exists bloom_subscription_admin_alert_trigger on public.shop_subscriptions;
create trigger bloom_subscription_admin_alert_trigger after insert or update on public.shop_subscriptions for each row execute function public.bloom_subscription_admin_alert();

-- Add one alert for each existing subscription so the dashboard is not blank after setup.
insert into public.platform_admin_notifications(shop_id,event_type,title,message,created_at)
select s.shop_id,'existing_subscription','Existing subscriber imported',coalesce(sh.name,'A florist') || ' is on the ' || initcap(replace(s.plan_code,'professional','Pro')) || ' plan.',s.created_at
from public.shop_subscriptions s join public.shops sh on sh.id=s.shop_id
where not exists(select 1 from public.platform_admin_notifications n where n.shop_id=s.shop_id and n.event_type='existing_subscription');
