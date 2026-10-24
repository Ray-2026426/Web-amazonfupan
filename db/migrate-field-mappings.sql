-- ============================================================
-- 云端字段映射：一次性迁移脚本
--
-- 用法：Supabase 控制台 → 左侧 SQL Editor → New query → 粘贴本文件全部内容 → Run
-- 可重复执行：建表用 if not exists，写默认值用 on conflict do nothing，
-- 所以你改过的映射不会被这次执行覆盖。
-- ============================================================

-- 1) 字段映射表：web 字段 ← 领星字段路径
create table if not exists field_mappings (
    web_field text primary key,
    export_label text not null,
    lingxing_field text not null,
    updated_at timestamptz not null default now()
);

-- 2) 37 个字段的默认映射（与 shared/field-mapping.mjs 保持一致）
--    pp.xxx 取自「产品表现 ASIN 列表」，op.xxx 取自「订单利润」按 sid|asin 归并后的成本
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

-- 3) 下线旧表：成本匹配规则、逐产品字段覆盖
drop table if exists cost_asin_rules;
drop table if exists product_overrides;

-- 4) 权限：只用服务端密钥访问，浏览器拿不到
alter table field_mappings enable row level security;
revoke all on table field_mappings from anon, authenticated;
grant select, insert, update, delete on table field_mappings to service_role;

-- 5) 自检：应返回 37
select count(*) as field_count from field_mappings;
