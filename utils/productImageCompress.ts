/** 导入时把嵌入图压成小缩略图，避免 IndexedDB / 渲染卡顿 */
const THUMB_MAX_PX = 64;
const THUMB_JPEG_QUALITY = 0.78;

export async function compressToThumbnail(dataUrl: string): Promise<string> {
    if (!dataUrl.startsWith('data:')) return dataUrl;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                let w = img.naturalWidth || 1;
                let h = img.naturalHeight || 1;
                const scale = Math.min(1, THUMB_MAX_PX / Math.max(w, h));
                w = Math.max(1, Math.round(w * scale));
                h = Math.max(1, Math.round(h * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(dataUrl);
                    return;
                }
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', THUMB_JPEG_QUALITY));
            } catch {
                resolve(dataUrl);
            }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

export async function compressDataUrlMapInBatches(
    map: Map<number, string>,
    batchSize = 10
): Promise<void> {
    const entries = Array.from(map.entries());
    for (let i = 0; i < entries.length; i += batchSize) {
        const chunk = entries.slice(i, i + batchSize);
        await Promise.all(
            chunk.map(async ([row, url]) => {
                map.set(row, await compressToThumbnail(url));
            })
        );
        await new Promise((r) => setTimeout(r, 0));
    }
}

export async function compressProductImageRows(
    rows: { image_url: string }[],
    batchSize = 10
): Promise<void> {
    for (let i = 0; i < rows.length; i += batchSize) {
        const chunk = rows.slice(i, i + batchSize);
        await Promise.all(
            chunk.map(async (row) => {
                if (row.image_url.startsWith('data:')) {
                    row.image_url = await compressToThumbnail(row.image_url);
                }
            })
        );
        await new Promise((r) => setTimeout(r, 0));
    }
}
