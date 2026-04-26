import { GoogleGenAI } from '@google/genai';
import {
    loadChatApiSettings,
    getKeyForProvider,
    getDashScopeChatUrl,
    getZhipuChatUrl,
    getDeepSeekChatUrl,
} from './aiApiConfig';

/** 与机器人设置中「API 与模型」一致；未配置时各功能会提示前往该处填写 */
export const AI_API_SETUP_HINT =
    '请打开右下角「业绩报告 AI 顾问」→ 右上角设置 →「API 与模型」中填写密钥并保存。';

export function hasConfiguredAiApi(): boolean {
    const s = loadChatApiSettings();
    return !!getKeyForProvider(s, s.provider);
}

export async function unifiedGenerateContent(options: {
    systemInstruction?: string;
    contents: string;
    /** Gemini 模型名；不传则使用设置里为 Gemini 保存的模型 */
    geminiModel?: string;
    /** 仅 Google Gemini 支持（如联网搜索）；国内模型将忽略此项 */
    geminiTools?: unknown[];
}): Promise<string> {
    const settings = loadChatApiSettings();
    const key = getKeyForProvider(settings, settings.provider);
    if (!key) {
        throw new Error(`未配置 API Key。${AI_API_SETUP_HINT}`);
    }

    const { systemInstruction, contents, geminiModel, geminiTools } = options;

    if (settings.provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey: key });
        const model = geminiModel || settings.models.gemini;
        const response = await ai.models.generateContent({
            model,
            config: {
                ...(systemInstruction ? { systemInstruction } : {}),
                ...(geminiTools?.length ? { tools: geminiTools } : {}),
            },
            contents,
        });
        return response.text || '';
    }

    const url =
        settings.provider === 'deepseek'
            ? getDeepSeekChatUrl()
            : settings.provider === 'dashscope'
              ? getDashScopeChatUrl()
              : getZhipuChatUrl();
    const model =
        settings.provider === 'deepseek'
            ? settings.models.deepseek
            : settings.provider === 'dashscope'
              ? settings.models.dashscope
              : settings.models.zhipu;
    const messages = [
        ...(systemInstruction ? [{ role: 'system' as const, content: systemInstruction }] : []),
        { role: 'user' as const, content: contents },
    ];

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model,
            messages,
            stream: false,
            temperature: 0.7,
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content;
    return typeof text === 'string' ? text : '';
}
