-- Bloom X v10.1 Inventory Pro
alter table public.inventory add column if not exists color text default '';
alter table public.inventory add column if not exists variety text default '';

-- Keep flower retail pricing at 3x wholesale even when data is added outside Bloom.
create or replace function public.bloom_inventory_price_3x()
returns trigger
language plpgsql
as $$
begin
  if lower(coalesce(new.category,'')) = 'flowers' then
    new.price := round(coalesce(new.cost,0) * 3, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists bloom_inventory_price_3x_trigger on public.inventory;
create trigger bloom_inventory_price_3x_trigger
before insert or update of cost, category on public.inventory
for each row execute function public.bloom_inventory_price_3x();

update public.inventory
set price = round(coalesce(cost,0) * 3, 2)
where lower(coalesce(category,'')) = 'flowers';

notify pgrst, 'reload schema';
