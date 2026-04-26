/** 机器人对话 API 配置（localStorage） */

export const CHATBOT_API_STORAGE_KEY = 'chatbot_api_settings';

export type ChatProviderId = 'gemini' | 'deepseek' | 'dashscope' | 'zhipu';

export interface ChatApiSettings {
    provider: ChatProviderId;
    keys: {
        gemini: string;
        deepseek: string;
        dashscope: string;
        zhipu: string;
    };
    models: {
        gemini: string;
        deepseek: string;
        dashscope: string;
        zhipu: string;
    };
}

export const DEFAULT_CHAT_API_SETTINGS: ChatApiSettings = {
    provider: 'gemini',
    keys: { gemini: '', deepseek: '', dashscope: '', zhipu: '' },
    models: {
        gemini: 'gemini-3-pro-preview',
        deepseek: 'deepseek/deepseek-chat',
        dashscope: 'qwen-plus',
        zhipu: 'glm-4',
    },
};

export interface ProviderMeta {
    id: ChatProviderId;
    region: 'intl' | 'cn';
    label: string;
    shortLabel: string;
    /** 简短说明：从哪里获取 Key */
    obtainPath: string;
    /** 跳转获取 Key 的官方页面 */
    obtainUrl: string;
    modelOptions: { value: string; label: string }[];
}

export const PROVIDER_METAS: ProviderMeta[] = [
    {
        id: 'gemini',
        region: 'intl',
        label: 'Google Gemini（国外）',
        shortLabel: 'Gemini',
        obtainPath: 'Google AI Studio → Get API key（获取 API 密钥）',
        obtainUrl: 'https://aistudio.google.com/apikey',
        modelOptions: [
            { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash（推荐）' },
            { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
            { value: 'gemini-2.5-flash-preview-05-20', label: 'gemini-2.5-flash-preview' },
            { value: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
        ],
    },
    {
        id: 'deepseek',
        region: 'intl',
        label: 'DeepSeek（API 基址 https://openrouter.fans/v1）',
        shortLabel: 'DeepSeek',
        obtainPath: '在 openrouter.fans（或您购买密钥的渠道）获取 Bearer API Key',
        obtainUrl: 'https://openrouter.fans/',
        modelOptions: [
            { value: 'deepseek/deepseek-chat', label: 'deepseek/deepseek-chat（对话）' },
            { value: 'deepseek/deepseek-reasoner', label: 'deepseek/deepseek-reasoner（推理）' },
            { value: 'deepseek-chat', label: 'deepseek-chat（短模型名，视网关而定）' },
        ],
    },
    {
        id: 'dashscope',
        region: 'cn',
        label: '阿里通义千问 DashScope（国内）',
        shortLabel: '通义千问',
        obtainPath: '阿里云控制台 → 模型服务灵积 / 百炼 → API-KEY 管理',
        obtainUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key',
        modelOptions: [
            { value: 'qwen-plus', label: 'qwen-plus' },
            { value: 'qwen-turbo', label: 'qwen-turbo' },
            { value: 'qwen-max', label: 'qwen-max' },
        ],
    },
    {
        id: 'zhipu',
        region: 'cn',
        label: '智谱 GLM（国内）',
        shortLabel: '智谱 GLM',
        obtainPath: '智谱 AI 开放平台 → 个人中心 → API Keys',
        obtainUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
        modelOptions: [
            { value: 'glm-4', label: 'glm-4' },
            { value: 'glm-4-flash', label: 'glm-4-flash' },
        ],
    },
];

export function loadChatApiSettings(): ChatApiSettings {
    try {
        const raw = localStorage.getItem(CHATBOT_API_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_CHAT_API_SETTINGS };
        const parsed = JSON.parse(raw) as Partial<ChatApiSettings>;
        return {
            ...DEFAULT_CHAT_API_SETTINGS,
            ...parsed,
            keys: { ...DEFAULT_CHAT_API_SETTINGS.keys, ...parsed.keys },
            models: { ...DEFAULT_CHAT_API_SETTINGS.models, ...parsed.models },
        };
    } catch {
        return { ...DEFAULT_CHAT_API_SETTINGS };
    }
}

export function saveChatApiSettings(settings: ChatApiSettings): void {
    localStorage.setItem(CHATBOT_API_STORAGE_KEY, JSON.stringify(settings));
}

/** 开发环境走 Vite 代理，减轻浏览器直连跨域问题 */
export function getDashScopeChatUrl(): string {
    const path = '/compatible-mode/v1/chat/completions';
    return import.meta.env.DEV ? `/dashscope${path}` : `https://dashscope.aliyuncs.com${path}`;
}

export function getZhipuChatUrl(): string {
    const path = '/api/paas/v4/chat/completions';
    return import.meta.env.DEV ? `/zhipu${path}` : `https://open.bigmodel.cn${path}`;
}

/** OpenAI 兼容 Chat Completions；基址为 https://openrouter.fans/v1 */
export function getDeepSeekChatUrl(): string {
    const path = '/chat/completions';
    return import.meta.env.DEV ? `/openrouterfans${path}` : `https://openrouter.fans/v1${path}`;
}

export function getEffectiveGeminiKey(settings: ChatApiSettings): string | null {
    const k = settings.keys.gemini?.trim();
    if (k) return k;
    const env = typeof process !== 'undefined' && process.env?.API_KEY;
    return env && String(env).trim() && String(env) !== 'PLACEHOLDER_API_KEY' ? String(env) : null;
}

export function getKeyForProvider(settings: ChatApiSettings, provider: ChatProviderId): string | null {
    const k = settings.keys[provider]?.trim();
    if (k) return k;
    if (provider === 'gemini') return getEffectiveGeminiKey(settings);
    return null;
}
