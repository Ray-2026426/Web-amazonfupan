import React from 'react';
import { KeyRound, Globe2, MapPin, ExternalLink } from 'lucide-react';
import {
    ChatApiSettings,
    PROVIDER_METAS,
    type ChatProviderId,
} from './aiApiConfig';

interface ChatApiSettingsPanelProps {
    value: ChatApiSettings;
    onChange: (next: ChatApiSettings) => void;
}

export const ChatApiSettingsPanel: React.FC<ChatApiSettingsPanelProps> = ({ value: settings, onChange }) => {
    const setProvider = (provider: ChatProviderId) => {
        onChange({ ...settings, provider });
    };

    const setKey = (id: ChatProviderId, v: string) => {
        onChange({ ...settings, keys: { ...settings.keys, [id]: v } });
    };

    const setModel = (id: ChatProviderId, v: string) => {
        onChange({ ...settings, models: { ...settings.models, [id]: v } });
    };

    const intl = PROVIDER_METAS.filter((m) => m.region === 'intl');
    const cn = PROVIDER_METAS.filter((m) => m.region === 'cn');

    return (
        <div className="space-y-4 pb-2 border-b border-slate-200">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <KeyRound className="w-4 h-4 text-amber-600" />
                API 与模型
            </div>
            <p className="text-xs text-slate-500">
                此处配置对全站 AI 功能生效（机器人对话、业绩/库存诊断、关键词、评论、退货分析等）。选择服务商并填写各平台 API Key，点击链接可前往对应官网获取密钥。
            </p>

            <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-600">当前使用</label>
                <select
                    value={settings.provider}
                    onChange={(e) => setProvider(e.target.value as ChatProviderId)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                >
                    {PROVIDER_METAS.map((m) => (
                        <option key={m.id} value={m.id}>
                            {m.label}
                        </option>
                    ))}
                </select>
            </div>

            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-600 uppercase tracking-wide">
                    <Globe2 className="w-3.5 h-3.5" />
                    国外模型
                </div>
                {intl.map((meta) => (
                    <React.Fragment key={meta.id}>
                        <ProviderBlock
                            meta={meta}
                            active={settings.provider === meta.id}
                            apiKey={settings.keys[meta.id]}
                            model={settings.models[meta.id]}
                            onKeyChange={(v) => setKey(meta.id, v)}
                            onModelChange={(v) => setModel(meta.id, v)}
                        />
                    </React.Fragment>
                ))}
            </div>

            <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-600 uppercase tracking-wide">
                    <MapPin className="w-3.5 h-3.5" />
                    国内模型
                </div>
                {cn.map((meta) => (
                    <React.Fragment key={meta.id}>
                        <ProviderBlock
                            meta={meta}
                            active={settings.provider === meta.id}
                            apiKey={settings.keys[meta.id]}
                            model={settings.models[meta.id]}
                            onKeyChange={(v) => setKey(meta.id, v)}
                            onModelChange={(v) => setModel(meta.id, v)}
                        />
                    </React.Fragment>
                ))}
            </div>

            <p className="text-[10px] text-slate-400 leading-relaxed">
                提示：国内 API 在部分部署环境下可能受浏览器跨域限制；本地开发已配置代理。若线上直连失败，可改用 Gemini 或在网关侧做反向代理。
            </p>
        </div>
    );
};

function ProviderBlock(props: {
    meta: (typeof PROVIDER_METAS)[number];
    active: boolean;
    apiKey: string;
    model: string;
    onKeyChange: (v: string) => void;
    onModelChange: (v: string) => void;
}) {
    const { meta, active, apiKey, model, onKeyChange, onModelChange } = props;
    return (
        <div
            className={`rounded-lg border p-3 space-y-2 ${
                active ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-200' : 'border-slate-200 bg-slate-50/80'
            }`}
        >
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-800">{meta.shortLabel}</span>
                {active && (
                    <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">当前选用</span>
                )}
            </div>
            <p className="text-[11px] text-slate-600 leading-snug">
                <span className="text-slate-500">获取路径：</span>
                {meta.obtainPath}
            </p>
            <a
                href={meta.obtainUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
            >
                前往获取 API Key
                <ExternalLink className="w-3 h-3" />
            </a>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <div className="space-y-1">
                    <label className="text-[10px] font-medium text-slate-500">API Key</label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(e) => onKeyChange(e.target.value)}
                        placeholder="粘贴 API Key"
                        className="w-full text-xs font-mono border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:border-blue-500 outline-none"
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-medium text-slate-500">模型</label>
                    <select
                        value={model}
                        onChange={(e) => onModelChange(e.target.value)}
                        className="w-full text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:border-blue-500 outline-none"
                    >
                        {meta.modelOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}
