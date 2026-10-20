-- 领星自动同步数据库（Supabase / 任意 PostgreSQL 14+）
--
-- 设计原则：
--   · 事实表只存数字和必要维度，嵌套数组（品类/品牌/价格列表）在入库前拍平成文本
--   · 三张事实表对应看板现有的三个数据源：日明细 / 月汇总 / 周汇总
--     （看板本身就是按「月表 / 周表」工作的，直接存汇总能省掉 30 倍的传输量）
--   · 唯一键 + upsert：同一天重跑不会重复累加
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
    currency            text        not null default 'USD',
    updated_at          timestamptz not null default now(),
    primary key (date, sid, asin, currency)
);

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
    (array_agg(rating order by date desc))[1] as rating
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
    (array_agg(rating order by date desc))[1] as rating
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

-- 写入和读取均经过服务端；前端只有单独的只读访问密码，拿不到 Supabase 密钥。
alter table fact_daily  enable row level security;
alter table sync_runs   enable row level security;

drop policy if exists "read fact_daily" on fact_daily;
drop policy if exists "read sync_runs" on sync_runs;
revoke all on table fact_daily, sync_runs from anon, authenticated;
revoke all on table v_fact_month, v_fact_week from anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update, delete on table fact_daily, sync_runs to service_role;
grant select on table v_fact_month, v_fact_week to service_role;
grant usage, select on sequence sync_runs_id_seq to service_role;

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
        parent_asin, product_name, sales_quantity, sales_amount, gross_profit,
        fba_sellable_qty, sessions, first_mile_cost, procurement_cost, storage_fee,
        fba_fee, refund_cost, platform_commission, ad_spend, ad_sales, ad_orders,
        sp_spend, sp_sales, sd_spend, sd_sales, sb_spend, sb_sales, sbv_spend, sbv_sales,
        impressions, clicks, natural_orders, natural_clicks, rating, review_count
    )
    select
        p_date, r.sid, r.asin, p_currency, r.country, r.shop_name, r.brand, r.manager, r.sub_category,
        r.parent_asin, r.product_name, r.sales_quantity, r.sales_amount, r.gross_profit,
        r.fba_sellable_qty, r.sessions, r.first_mile_cost, r.procurement_cost, r.storage_fee,
        r.fba_fee, r.refund_cost, r.platform_commission, r.ad_spend, r.ad_sales, r.ad_orders,
        r.sp_spend, r.sp_sales, r.sd_spend, r.sd_sales, r.sb_spend, r.sb_sales, r.sbv_spend, r.sbv_sales,
        r.impressions, r.clicks, r.natural_orders, r.natural_clicks, r.rating, r.review_count
    from jsonb_to_recordset(p_rows) as r (
        date date, sid text, asin text, country text, shop_name text, brand text,
        manager text, sub_category text, parent_asin text, product_name text,
        sales_quantity numeric, sales_amount numeric, gross_profit numeric,
        fba_sellable_qty numeric, sessions numeric, first_mile_cost numeric,
        procurement_cost numeric, storage_fee numeric, fba_fee numeric,
        refund_cost numeric, platform_commission numeric, ad_spend numeric,
        ad_sales numeric, ad_orders numeric, sp_spend numeric, sp_sales numeric,
        sd_spend numeric, sd_sales numeric, sb_spend numeric, sb_sales numeric,
        sbv_spend numeric, sbv_sales numeric, impressions numeric, clicks numeric,
        natural_orders numeric, natural_clicks numeric, rating numeric, review_count numeric
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

create table if not exists cost_asin_rules (
    sid text not null,
    local_sku text not null,
    asin text not null,
    updated_at timestamptz not null default now(),
    primary key (sid, local_sku)
);

create table if not exists product_overrides (
    sid text not null,
    asin text not null,
    brand text,
    manager text,
    sub_category text,
    parent_asin text,
    product_name text,
    updated_at timestamptz not null default now(),
    primary key (sid, asin)
);

alter table sync_settings enable row level security;
alter table cost_asin_rules enable row level security;
alter table product_overrides enable row level security;
revoke all on table sync_settings, cost_asin_rules, product_overrides from anon, authenticated;
grant select, insert, update, delete on table sync_settings, cost_asin_rules, product_overrides to service_role;
