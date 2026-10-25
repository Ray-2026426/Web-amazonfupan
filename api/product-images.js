import { respond, fetchTable } from '../serverless/supabase.js';

/**
 * 商品图片表（云端常驻）：上传一次后，看板每次打开自动读取，不用重复上传。
 * 只读接口，和 /api/data 共用只读密码。
 */
export default function handler(req, res) {
  return respond(req, res, async () => {
    const rows = await fetchTable('product_images', {
      select: 'sku,product_name,image_url',
      order: 'id.asc',
    }, 20000);
    return res.status(200).json({ count: rows.length, rows });
  });
}
