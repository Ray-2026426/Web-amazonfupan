/** OpenAI 兼容 Chat Completions 流式解析（通义 / 智谱） */

export async function streamOpenAICompatibleChat(options: {
    url: string;
    apiKey: string;
    model: string;
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    onDelta: (text: string) => void;
    signal?: AbortSignal;
}): Promise<void> {
    const { url, apiKey, model, messages, onDelta, signal } = options;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages,
            stream: true,
            temperature: 0.7,
        }),
        signal,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `HTTP ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
                const json = JSON.parse(payload) as {
                    choices?: { delta?: { content?: string }; message?: { content?: string } }[];
                };
                const delta =
                    json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content;
                if (delta) onDelta(delta);
            } catch {
                // 忽略单行解析失败
            }
        }
    }
}
