import { parseProductImageData } from '../dataLoader';

/**
 * 商品图片上传任务。
 *
 * 为什么放在模块级：解析几千行 xlsx + 分批上传要好几十秒，
 * 用户关掉面板、切标签页都不应该中断。状态存在模块里，面板/浮层都只是订阅者。
 */
export type ImageUploadState = {
    status: 'idle' | 'parsing' | 'uploading' | 'activating' | 'done' | 'error';
    fileName: string;
    done: number;
    total: number;
    message: string;
    startedAt: number;
};

let state: ImageUploadState = { status: 'idle', fileName: '', done: 0, total: 0, message: '', startedAt: 0 };
const listeners = new Set<(next: ImageUploadState) => void>();

const emit = (patch: Partial<ImageUploadState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
};

export const getImageUploadState = () => state;

export const subscribeImageUpload = (listener: (next: ImageUploadState) => void) => {
    listeners.add(listener);
    listener(state);
    return () => { listeners.delete(listener); };
};

export const resetImageUpload = () => emit({ status: 'idle', fileName: '', done: 0, total: 0, message: '', startedAt: 0 });

type Requester = (method: 'GET' | 'POST', body?: unknown) => Promise<any>;

let running = false;

/** 返回 false 表示已有任务在跑 */
export async function startImageUpload(file: File, request: Requester): Promise<boolean> {
    if (running) return false;
    running = true;
    emit({ status: 'parsing', fileName: file.name, done: 0, total: 0, message: '正在解析表格…', startedAt: Date.now() });
    try {
        const parsed = await parseProductImageData(file);
        const rows = (parsed.data || []).filter(row => row.image_url && /^https?:\/\//i.test(String(row.image_url).trim()));
        if (!rows.length) {
            emit({ status: 'error', message: '没有读到有效的图片链接（需要 sku / 品名 + 图片URL）' });
            return true;
        }

        emit({ status: 'uploading', total: rows.length, done: 0, message: '' });
        const started = await request('POST', { action: 'images_start', source_filename: file.name, expected_rows: rows.length }) as { import_id: string };
        const size = 400;
        for (let offset = 0; offset < rows.length; offset += size) {
            await request('POST', {
                action: 'images_batch',
                import_id: started.import_id,
                rows: rows.slice(offset, offset + size).map(row => ({
                    sku: row.sku || '',
                    product_name: row.product_name || '',
                    image_url: row.image_url,
                })),
            });
            emit({ done: Math.min(offset + size, rows.length) });
        }

        emit({ status: 'activating', message: '正在启用…' });
        await request('POST', { action: 'images_activate', import_id: started.import_id });
        emit({ status: 'done', message: `已保存 ${rows.length} 行` });
        return true;
    } catch (error) {
        emit({ status: 'error', message: String(error instanceof Error ? error.message : error) });
        return true;
    } finally {
        running = false;
    }
}
