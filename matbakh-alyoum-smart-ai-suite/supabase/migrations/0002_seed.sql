insert into public.menu_categories (id, slug, name, sort_order, is_active)
values
  ('mahashi', 'mahashi', 'محاشي', 1, true),
  ('home-food', 'home-food', 'طبخات بيتية', 2, true),
  ('ready-to-cook', 'ready-to-cook', 'جاهز للطبخ', 3, true),
  ('frozen-chilled', 'frozen-chilled', 'مفرز ومبرد', 4, true)
on conflict (id) do update
set slug = excluded.slug,
    name = excluded.name,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

insert into public.menu_items (id, category_id, sku, title, description, unit_label, base_price, sort_order, is_active)
values
  ('zucchini-mahshi', 'mahashi', 'MY-ZM-01', 'كوسا محشي باللحم', 'طعم بيتي غني', 'الربعة', 8.50, 1, true),
  ('warak-enab', 'mahashi', 'MY-WE-01', 'ورق عنب', 'تتبيلة مميزة', 'الربعة', 8.00, 2, true),
  ('malfouf', 'mahashi', 'MY-MA-01', 'ملفوف بلدي', 'حشوة متوازنة', 'الربعة', 8.00, 3, true),
  ('maqloubeh', 'home-food', 'MY-MQ-01', 'مقلوبة', 'بيتية أصيلة', 'الصحن', 18.00, 1, true),
  ('qudra', 'home-food', 'MY-QD-01', 'قدرة', 'أرز ولحم', 'الصحن', 20.00, 2, true),
  ('frozen-kubbeh', 'frozen-chilled', 'MY-FK-01', 'كبة مفرزة', 'جاهزة للقلي', 'العلبة', 6.00, 1, true)
on conflict (id) do update
set category_id = excluded.category_id,
    sku = excluded.sku,
    title = excluded.title,
    description = excluded.description,
    unit_label = excluded.unit_label,
    base_price = excluded.base_price,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;

insert into public.delivery_zones (id, name, delivery_fee, min_eta_minutes, max_eta_minutes, sort_order, is_active)
values
  ('umm-summaq', 'أم السماق', 2.00, 30, 60, 1, true),
  ('sweifieh', 'الصويفية', 2.50, 35, 70, 2, true),
  ('dabouq', 'دابوق', 3.00, 40, 75, 3, true),
  ('khalda', 'خلدا', 3.00, 40, 75, 4, true)
on conflict (id) do update
set name = excluded.name,
    delivery_fee = excluded.delivery_fee,
    min_eta_minutes = excluded.min_eta_minutes,
    max_eta_minutes = excluded.max_eta_minutes,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active;
