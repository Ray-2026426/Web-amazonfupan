-- 领星自动同步数据库（Supabase / 任意 PostgreSQL 14+）
--
-- 设计原则：
--   · 事实表只存数字和必要维度，嵌套数组（品类/品牌/价格列表）在入库前拍平成文本
--   · 一张日明细事实表长期保存数据；月/周汇总由视图按需计算
--   · 同一天重跑时在事务内整体替换，避免重复累加或留下半份数据
--   · RLS：业务数据不允许匿名读取；仅服务端 secret key 对应的 service_role 访问

create table if not exists fact_daily (
    date                date        not null,
    sid                 text        not null,
    asin                text        not null,
    country             text,
    shop_name           text,
    brand               text,
    manager             text,
    sub_category        text,
    parent_asin         text,
    product_name        text,
    sales_quantity      numeric,
    order_quantity      numeric,
    sales_amount        numeric,
    gross_profit        numeric,
    fba_sellable_qty    numeric,
    sessions            numeric,
    first_mile_cost     numeric,
    procurement_cost    numeric,
    storage_fee         numeric,
    fba_fee             numeric,
    refund_cost         numeric,
    platform_commission numeric,
    ad_spend            numeric,
    ad_sales            numeric,
    ad_orders           numeric,
    sp_spend            numeric,
    sp_sales            numeric,
    sd_spend            numeric,
    sd_sales            numeric,
    sb_spend            numeric,
    sb_sales            numeric,
    sbv_spend           numeric,
    sbv_sales           numeric,
    impressions         numeric,
    clicks              numeric,
    natural_orders      numeric,
    natural_clicks      numeric,
    rating              numeric,
    review_count        numeric,
    -- FBA 国际运费：领星把它算进了头程，又在毛利里扣了一次；单独存下来，看板可选择加回
    fba_international_fee numeric,
    currency            text        not null default 'USD',
    updated_at          timestamptz not null default now(),
    primary key (date, sid, asin, currency)
);
alter table fact_daily add column if not exists order_quantity numeric;
alter table fact_daily add column if not exists fba_international_fee numeric;

-- 月汇总 / 周汇总：用视图从 fact_daily 现算，而不是另存一张表。
-- 原因：定时任务每次只拉 3 天，如果按窗口推汇总，跨月/跨周会写出「半个月」的错数。
-- 视图永远基于全部日明细，天然不会有这个问题。
create or replace view v_fact_month as
select
    to_char(date, 'YYYY-MM') as period,
    sid, asin, country, shop_name, brand, manager, sub_category, parent_asin, product_name, currency,
    sum(sales_quantity) as sales_quantity,
    sum(sales_amount) as sales_amount,
    sum(gross_profit) as gross_profit,
    sum(sessions) as sessions,
    sum(first_mile_cost) as first_mile_cost,
    sum(procurement_cost) as procurement_cost,
    sum(storage_fee) as storage_fee,
    sum(fba_fee) as fba_fee,
    sum(refund_cost) as refund_cost,
    sum(platform_commission) as platform_commission,
    sum(ad_spend) as ad_spend,
    sum(ad_sales) as ad_sales,
    sum(ad_orders) as ad_orders,
    sum(sp_spend) as sp_spend, sum(sp_sales) as sp_sales,
    sum(sd_spend) as sd_spend, sum(sd_sales) as sd_sales,
    sum(sb_spend) as sb_spend, sum(sb_sales) as sb_sales,
    sum(sbv_spend) as sbv_spend, sum(sbv_sales) as sbv_sales,
    sum(impressions) as impressions,
    sum(clicks) as clicks,
    sum(natural_orders) as natural_orders,
    sum(natural_clicks) as natural_clicks,
    (array_agg(review_count order by date desc))[1] as review_count,
    (array_agg(fba_sellable_qty order by date desc))[1] as fba_sellable_qty,
    (array_agg(rating order by date desc))[1] as rating,
    sum(order_quantity) as order_quantity,
    sum(fba_international_fee) as fba_international_fee
from fact_daily
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

-- 周汇总：看板用的是「周日起算」的自然周，date_trunc('week') 是周一起算，必须手算
create or replace view v_fact_week as
select
    to_char(date - (extract(dow from date)::int), 'IYYY-"W"IW') as period,
    (date - (extract(dow from date)::int)) as week_start,
    sid, asin, country, shop_name, brand, manager, sub_category, parent_asin, product_name, currency,
    sum(sales_quantity) as sales_quantity,
    sum(sales_amount) as sales_amount,
    sum(gross_profit) as gross_profit,
    sum(sessions) as sessions,
    sum(first_mile_cost) as first_mile_cost,
    sum(procurement_cost) as procurement_cost,
    sum(storage_fee) as storage_fee,
    sum(fba_fee) as fba_fee,
    sum(refund_cost) as refund_cost,
    sum(platform_commission) as platform_commission,
    sum(ad_spend) as ad_spend,
    sum(ad_sales) as ad_sales,
    sum(ad_orders) as ad_orders,
    sum(sp_spend) as sp_spend, sum(sp_sales) as sp_sales,
    sum(sd_spend) as sd_spend, sum(sd_sales) as sd_sales,
    sum(sb_spend) as sb_spend, sum(sb_sales) as sb_sales,
    sum(sbv_spend) as sbv_spend, sum(sbv_sales) as sbv_sales,
    sum(impressions) as impressions,
    sum(clicks) as clicks,
    sum(natural_orders) as natural_orders,
    sum(natural_clicks) as natural_clicks,
    (array_agg(review_count order by date desc))[1] as review_count,
    (array_agg(fba_sellable_qty order by date desc))[1] as fba_sellable_qty,
    (array_agg(rating order by date desc))[1] as rating,
    sum(fba_international_fee) as fba_international_fee
from fact_daily
group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12;

-- 每次同步的审计记录（前端据此显示「数据截至日 / 上次同步」
create table if not exists sync_runs (
    id              bigserial primary key,
    started_at      timestamptz not null,
    finished_at     timestamptz,
    range_from      date,
    range_to        date,
    status          text not null check (status in ('running', 'ok', 'failed')),
    rows_daily      integer default 0,
    rows_period     integer default 0,
    cost_match_rate numeric,
    failed_shops    integer default 0,
    mcp_calls       integer default 0,
    duration_ms     integer,
    warnings        jsonb default '[]'::jsonb,
    error           text
);

create index if not exists idx_fact_daily_date on fact_daily (date);
create index if not exists idx_fact_daily_date_sid on fact_daily (date, sid);
create index if not exists idx_fact_daily_asin on fact_daily (asin);
create index if not exists idx_fact_daily_period on fact_daily (date, sid, asin);

-- 每日覆盖：数据质量页用，一天一行，方便一次看清哪些日期缺数据、哪些数字异常
create or replace view v_fact_daily_coverage as
select
    date,
    count(*)::int as rows,
    coalesce(sum(sales_amount), 0) as sales_amount,
    coalesce(sum(gross_profit), 0) as gross_profit,
    max(updated_at) as updated_at
from fact_daily
group by date;

-- ---------------------------------------------------------------------------
-- 区间聚合：首屏 KPI / 利润表只需要的合计值，在数据库里算完再返回（几十字节 vs 十几万行）
-- ---------------------------------------------------------------------------
create or replace function public.aggregate_range(p_from date, p_to date)
returns jsonb
language sql
security invoker
set search_path = public
as $$
    select to_jsonb(t) from (
        select
            count(*)::int as rows,
            coalesce(sum(sales_quantity), 0) as sales_quantity,
            coalesce(sum(order_quantity), 0) as order_quantity,
            coalesce(sum(sales_amount), 0) as sales_amount,
            coalesce(sum(gross_profit), 0) as gross_profit,
            coalesce(sum(sessions), 0) as sessions,
            coalesce(sum(first_mile_cost), 0) as first_mile_cost,
            coalesce(sum(procurement_cost), 0) as procurement_cost,
            coalesce(sum(storage_fee), 0) as storage_fee,
            coalesce(sum(fba_fee), 0) as fba_fee,
            coalesce(sum(refund_cost), 0) as refund_cost,
            coalesce(sum(platform_commission), 0) as platform_commission,
            coalesce(sum(ad_spend), 0) as ad_spend,
            coalesce(sum(ad_sales), 0) as ad_sales,
            coalesce(sum(ad_orders), 0) as ad_orders,
            coalesce(sum(sp_spend), 0) as sp_spend,
            coalesce(sum(sp_sales), 0) as sp_sales,
            coalesce(sum(sd_spend), 0) as sd_spend,
            coalesce(sum(sd_sales), 0) as sd_sales,
            coalesce(sum(sb_spend), 0) as sb_spend,
            coalesce(sum(sb_sales), 0) as sb_sales,
            coalesce(sum(sbv_spend), 0) as sbv_spend,
            coalesce(sum(sbv_sales), 0) as sbv_sales,
            coalesce(sum(impressions), 0) as impressions,
            coalesce(sum(clicks), 0) as clicks,
            coalesce(sum(natural_orders), 0) as natural_orders,
            coalesce(sum(natural_clicks), 0) as natural_clicks,
            coalesce(sum(fba_international_fee), 0) as fba_international_fee,
            coalesce(avg(rating) filter (where rating > 0), 0) as rating,
            coalesce(sum(review_count), 0) as review_count,
            coalesce(max(fba_sellable_qty), 0) as fba_sellable_qty
        from fact_daily
        where date between p_from and p_to
    ) t;
$$;
revoke all on function public.aggregate_range(date, date) from public, anon, authenticated;
grant execute on function public.aggregate_range(date, date) to service_role;

-- ---------------------------------------------------------------------------
-- 每日库存快照：每天抓一次领星「FBA 库存」，按 日期+店铺+MSKU 存一行
-- ---------------------------------------------------------------------------
create table if not exists fact_inventory (
    date date not null,
    sid text not null,
    asin text,
    msku text not null,
    fnsku text,
    product_name text,
    shop_name text,
    parent_asin text,
    fulfillable numeric,          -- FBA 可售
    reserved numeric,             -- 预留
    inbound_shipped numeric,      -- 在途：已发货
    inbound_receiving numeric,    -- 在途：收货中
    inbound_working numeric,      -- 在途：处理中
    researching numeric,          -- 调查中
    unsellable numeric,           -- 不可售
    total_onhand numeric,         -- 在库合计
    days_of_supply numeric,       -- 可售天数（领星口径）
    sell_through numeric,         -- 售罄率
    health text,                  -- 库存健康度
    unit_cost numeric,
    total_cost numeric,
    pic_url text,
    updated_at timestamptz not null default now(),
    primary key (date, sid, msku)
);
create index if not exists idx_fact_inventory_date on fact_inventory (date);
alter table fact_inventory enable row level security;
revoke all on table fact_inventory from anon, authenticated;
grant select, insert, update, delete on table fact_inventory to service_role;

-- 每日对账：同步时把「我们算的毛利」与「领星订单利润合计」记下来，
-- 数据质量页据此标出差异过大的日期，不用等人工发现。
create table if not exists daily_checks (
    date date primary key,    expected_gross_profit numeric,
    actual_gross_profit numeric,
    diff_ratio numeric,
    checked_at timestamptz not null default now()
);

-- 补数队列：没有 GitHub 令牌时，页面把请求写这里，定时工作流来消费
create table if not exists sync_requests (
    id bigserial primary key,
    dates text[] not null,
    status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
    note text,
    created_at timestamptz not null default now(),
    processed_at timestamptz
);
create index if not exists idx_sync_requests_pending on sync_requests (status, created_at);

-- 写入和读取均经过服务端；前端只有单独的只读访问密码，拿不到 Supabase 密钥。
alter table fact_daily  enable row level security;
alter table sync_runs   enable row level security;

drop policy if exists "read fact_daily" on fact_daily;
drop policy if exists "read sync_runs" on sync_runs;
revoke all on table fact_daily, sync_runs from anon, authenticated;
revoke all on table v_fact_month, v_fact_week, v_fact_daily_coverage from anon, authenticated;
revoke all on table daily_checks, sync_requests from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table fact_daily, sync_runs, daily_checks, sync_requests to service_role;
grant select on table v_fact_month, v_fact_week, v_fact_daily_coverage to service_role;
grant usage, select on sequence sync_runs_id_seq to service_role;
grant usage, select on sequence sync_requests_id_seq to service_role;

-- 视图默认沿用基表权限（Postgres 15+ 的 security_invoker 让 RLS 生效）
alter view v_fact_month set (security_invoker = true);
alter view v_fact_week  set (security_invoker = true);

-- 每一天的替换在数据库内完成一个事务。任何字段、主键或权限错误都会回滚 DELETE。
create or replace function public.replace_fact_daily(p_date date, p_currency text, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    inserted_count integer;
begin
    if p_date is null or p_currency is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'invalid daily sync payload';
    end if;
    if exists (select 1 from jsonb_array_elements(p_rows) item where item->>'date' is distinct from p_date::text) then
        raise exception 'daily sync date mismatch';
    end if;
    delete from fact_daily where date = p_date and currency = p_currency;
    insert into fact_daily (
        date, sid, asin, currency, country, shop_name, brand, manager, sub_category,
        parent_asin, product_name, sales_quantity, order_quantity, sales_amount, gross_profit,
        fba_sellable_qty, sessions, first_mile_cost, procurement_cost, storage_fee,
        fba_fee, refund_cost, platform_commission, ad_spend, ad_sales, ad_orders,
        sp_spend, sp_sales, sd_spend, sd_sales, sb_spend, sb_sales, sbv_spend, sbv_sales,
        impressions, clicks, natural_orders, natural_clicks, rating, review_count, fba_international_fee
    )
    select
        p_date, r.sid, r.asin, p_currency, r.country, r.shop_name, r.brand, r.manager, r.sub_category,
        r.parent_asin, r.product_name, r.sales_quantity, r.order_quantity, r.sales_amount, r.gross_profit,
        r.fba_sellable_qty, r.sessions, r.first_mile_cost, r.procurement_cost, r.storage_fee,
        r.fba_fee, r.refund_cost, r.platform_commission, r.ad_spend, r.ad_sales, r.ad_orders,
        r.sp_spend, r.sp_sales, r.sd_spend, r.sd_sales, r.sb_spend, r.sb_sales, r.sbv_spend, r.sbv_sales,
        r.impressions, r.clicks, r.natural_orders, r.natural_clicks, r.rating, r.review_count, r.fba_international_fee
    from jsonb_to_recordset(p_rows) as r (
        date date, sid text, asin text, country text, shop_name text, brand text,
        manager text, sub_category text, parent_asin text, product_name text,
        sales_quantity numeric, order_quantity numeric, sales_amount numeric, gross_profit numeric,
        fba_sellable_qty numeric, sessions numeric, first_mile_cost numeric,
        procurement_cost numeric, storage_fee numeric, fba_fee numeric,
        refund_cost numeric, platform_commission numeric, ad_spend numeric,
        ad_sales numeric, ad_orders numeric, sp_spend numeric, sp_sales numeric,
        sd_spend numeric, sd_sales numeric, sb_spend numeric, sb_sales numeric,
        sbv_spend numeric, sbv_sales numeric, impressions numeric, clicks numeric,
        natural_orders numeric, natural_clicks numeric, rating numeric, review_count numeric,
        fba_international_fee numeric
    );
    get diagnostics inserted_count = row_count;
    if inserted_count <> jsonb_array_length(p_rows) then
        raise exception 'daily sync row count mismatch';
    end if;
    return inserted_count;
end;
$$;

revoke all on function public.replace_fact_daily(date, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_fact_daily(date, text, jsonb) to service_role;

-- 管理后台配置。浏览器只调用受管理密码保护的 Vercel API。
create table if not exists sync_settings (
    id integer primary key default 1 check (id = 1),
    enabled boolean not null default true,
    lookback_days integer not null default 3 check (lookback_days between 1 and 14),
    updated_at timestamptz not null default now()
);
insert into sync_settings (id) values (1) on conflict (id) do nothing;

-- 字段映射：web 字段 ← 领星字段路径。
-- 领星返回的字段名会变（例如品名从 item_name 改成 price_list[].local_name），
-- 把「取哪个字段」做成配置，改配置即可，不用发版。export_label 是下载表格里的列名。
create table if not exists field_mappings (
    web_field text primary key,
    export_label text not null,
    lingxing_field text not null,
    updated_at timestamptz not null default now()
);
insert into field_mappings (web_field, export_label, lingxing_field) values
    ('asin', 'ASIN', 'pp.asin'),
    ('parent_asin', '父ASIN', 'pp.parent_asins[].parent_asin'),
    ('shop_name', '店铺', 'pp.seller_store_countries[].seller_name'),
    ('country', '国家', 'pp.seller_store_countries[].country'),
    ('manager', '负责人', 'pp.principal_names[]'),
    ('product_name', '品名', 'pp.price_list[].local_name@max(volume)'),
    ('sub_category', '二级分类', 'pp.categories[]@level(2)'),
    ('brand', '品牌', 'pp.brands[]'),
    ('sales_quantity', '销量', 'pp.volume'),
    ('sales_amount', '销售额', 'pp.amount'),
    ('order_quantity', '订单量', 'pp.order_items'),
    ('gross_profit', '订单毛利润', 'op.gross_profit'),
    ('refund_cost', '退款金额', 'op.refund_amount'),
    ('first_mile_cost', '头程费用', 'op.logistics_costs'),
    ('fba_fee', 'FBA费用', 'op.fulfillment_fee'),
    ('storage_fee', '仓储费用', 'op.fba_storage_fee'),
    ('procurement_cost', '采购费用', 'op.purchase_costs'),
    ('platform_commission', '佣金费用', 'op.selling_fee'),
    ('sessions', 'Sessions-Total', 'pp.sessions_total'),
    ('fba_sellable_qty', 'FBA-可售', 'pp.afn_fulfillable_quantity'),
    ('impressions', '展示', 'pp.impressions'),
    ('clicks', '点击', 'pp.clicks'),
    ('natural_clicks', '自然点击量', 'pp.nature_click'),
    ('natural_orders', '自然订单量', 'pp.nature_order_items'),
    ('rating', '评分', 'pp.avg_star'),
    ('review_count', '评论数', 'pp.reviews_count'),
    ('ad_spend', '广告花费', 'pp.spend'),
    ('sp_spend', 'SP广告费', 'pp.ads_sp_cost'),
    ('sd_spend', 'SD广告费', 'pp.ads_sd_cost'),
    ('sb_spend', 'SB广告费', 'pp.shared_ads_sb_cost'),
    ('sbv_spend', 'SBV广告费', 'pp.shared_ads_sbv_cost'),
    ('ad_sales', '广告销售额', 'pp.ad_sales_amount'),
    ('sp_sales', 'SP广告销售额', 'pp.ads_sp_sales'),
    ('sd_sales', 'SD广告销售额', 'pp.ads_sd_sales'),
    ('sb_sales', 'SB广告销售额', 'pp.shared_ads_sb_sales'),
    ('sbv_sales', 'SBV广告销售额', 'pp.shared_ads_sbv_sales'),
    ('ad_orders', '广告订单量', 'pp.ad_order_quantity')
on conflict (web_field) do nothing;

-- 成本匹配 / 逐产品字段覆盖已下线：前者用不上，后者由上面的字段映射取代。
drop table if exists cost_asin_rules;
drop table if exists product_overrides;

alter table sync_settings enable row level security;
alter table field_mappings enable row level security;
revoke all on table sync_settings, field_mappings from anon, authenticated;
grant select, insert, update, delete on table sync_settings, field_mappings to service_role;

-- 目标表按上传批次保存。新批次上传完并校验行数后才切换为生效版本，
-- 避免上传中断时看板读到半份目标。
create table if not exists target_imports (
    id uuid primary key,
    source_filename text not null,
    expected_rows integer not null check (expected_rows > 0 and expected_rows <= 100000),
    status text not null default 'staging' check (status in ('staging', 'active', 'archived')),
    active boolean not null default false,
    created_at timestamptz not null default now(),
    activated_at timestamptz
);
create unique index if not exists idx_target_import_one_active on target_imports (active) where active;
-- 覆盖率摘要：上传时由前端算好，避免后台扫全表
alter table target_imports add column if not exists covered_shops integer;
alter table target_imports add column if not exists covered_asins integer;
alter table target_imports add column if not exists months text;

create table if not exists target_rows (
    import_id uuid not null references target_imports(id) on delete cascade,
    row_no integer not null check (row_no >= 0),
    month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    primary key (import_id, row_no)
);
create index if not exists idx_target_rows_import_month on target_rows (import_id, month);

alter table target_imports enable row level security;
alter table target_rows enable row level security;
revoke all on table target_imports, target_rows from anon, authenticated;
grant select, insert, update, delete on table target_imports, target_rows to service_role;

create or replace function public.activate_target_import(p_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    expected integer;
    actual integer;
begin
    select expected_rows into expected from target_imports where id = p_id and status = 'staging' for update;
    if expected is null then raise exception 'target import not found or already activated'; end if;
    select count(*) into actual from target_rows where import_id = p_id;
    if actual <> expected then raise exception 'target import incomplete: % of % rows', actual, expected; end if;
    update target_imports set active = false, status = 'archived' where active;
    update target_imports set active = true, status = 'active', activated_at = now() where id = p_id;
    return actual;
end;
$$;
revoke all on function public.activate_target_import(uuid) from public, anon, authenticated;
grant execute on function public.activate_target_import(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 商品图片表：上传一次常驻云端，看板每次打开自动读取（不再依赖本地导入）
-- ---------------------------------------------------------------------------
create table if not exists product_image_imports (
    id uuid primary key,
    source_filename text,
    expected_rows integer not null,
    rows_count integer,
    status text not null check (status in ('staging', 'active', 'archived')) default 'staging',
    active boolean not null default false,
    activated_at timestamptz
);
create unique index if not exists idx_image_import_one_active on product_image_imports (active) where active;

create table if not exists product_images (
    id bigserial primary key,
    import_id uuid not null,
    sku text,
    product_name text,
    image_url text not null,
    updated_at timestamptz not null default now()
);
create index if not exists idx_product_images_import on product_images (import_id);
-- 图片表按「本地 SKU」导出也能用：上传时用 product_links 把 SKU 翻译成 ASIN
alter table product_images add column if not exists asin text;

-- MSKU ↔ ASIN 对照：每次同步订单利润时累积写入，供图片表翻译用
create table if not exists product_links (
    msku text not null,
    asin text not null,
    local_name text,
    sid text,
    updated_at timestamptz not null default now(),
    primary key (msku, asin)
);
create index if not exists idx_product_links_asin on product_links (asin);
alter table product_links enable row level security;
revoke all on table product_links from anon, authenticated;
grant select, insert, update, delete on table product_links to service_role;

alter table product_images enable row level security;
alter table product_image_imports enable row level security;
revoke all on table product_images, product_image_imports from anon, authenticated;
grant select, insert, update, delete on table product_images, product_image_imports to service_role;
grant usage, select on sequence product_images_id_seq to service_role;

-- 激活：行数校验 → 旧批次标归档 → 清理旧图片 → 新批次生效
create or replace function public.activate_image_import(p_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    expected integer;
    actual integer;
begin
    select expected_rows into expected from product_image_imports where id = p_id and status = 'staging' for update;
    if expected is null then raise exception 'image import not found or already activated'; end if;
    select count(*) into actual from product_images where import_id = p_id;
    if actual <> expected then raise exception 'image import incomplete: % of % rows', actual, expected; end if;
    -- 按本地 SKU 自动翻译成 ASIN（用户导出的产品表通常只有 SKU，没有 ASIN）
    update product_images img
       set asin = l.asin
      from product_links l
     where img.import_id = p_id
       and img.asin is null
       and img.sku is not null
       and lower(btrim(img.sku)) = lower(btrim(l.msku));
    update product_image_imports set active = false, status = 'archived' where active;
    update product_image_imports set active = true, status = 'active', rows_count = actual, activated_at = now() where id = p_id;
    delete from product_images where import_id <> p_id;
    return actual;
end;
$$;
revoke all on function public.activate_image_import(uuid) from public, anon, authenticated;
grant execute on function public.activate_image_import(uuid) to service_role;

-- 已上传的图片表事后重新匹配 ASIN（同步补全 product_links 后点一下即可，不用重传）
create or replace function public.relink_image_asins()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
    n integer;
begin
    update product_images img
       set asin = l.asin
      from product_links l
     where img.asin is null
       and img.sku is not null
       and lower(btrim(img.sku)) = lower(btrim(l.msku));
    get diagnostics n = row_count;
    return n;
end;
$$;
revoke all on function public.relink_image_asins() from public, anon, authenticated;
grant execute on function public.relink_image_asins() to service_role;

-- 图片表体检：前端用它显示「总行数 / 已匹配 ASIN / 最近上传」，排查图片为什么不显示
create or replace function public.image_stats()
returns jsonb
language sql
security invoker
set search_path = public
as $$
    select jsonb_build_object(
        'total', count(*),
        'with_asin', count(*) filter (where asin is not null),
        'last_import', (select max(activated_at) from product_image_imports where active)
    )
    from product_images;
$$;
revoke all on function public.image_stats() from public, anon, authenticated;
grant execute on function public.image_stats() to service_role;
