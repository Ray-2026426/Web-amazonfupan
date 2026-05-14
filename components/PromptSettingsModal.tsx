
import React, { useState, useEffect } from 'react';
import { X, Save, RotateCcw, BookOpen, UserCog, FileText } from 'lucide-react';
import { ChatApiSettingsPanel } from './ChatApiSettingsPanel';
import {
    CHATBOT_API_STORAGE_KEY,
    ChatApiSettings,
    DEFAULT_CHAT_API_SETTINGS,
    loadChatApiSettings,
    saveChatApiSettings,
} from './aiApiConfig';
import { useEscClose } from './useEscClose';

interface PromptSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    configKey: string; // Unique key for localStorage (e.g., 'chatbot_settings')
    title: string;
    defaultSystemPrompt: string;
    defaultTemplate?: string; // Optional, for one-shot generation tasks
    /** 默认知识库正文；未保存过或旧数据无 knowledgeBase 字段时使用 */
    defaultKnowledgeBase?: string;
    /** 机器人对话：在设置中展示 API / 国内外模型配置 */
    showChatApiSettings?: boolean;
}

export const PromptSettingsModal: React.FC<PromptSettingsModalProps> = ({
    isOpen,
    onClose,
    configKey,
    title,
    defaultSystemPrompt,
    defaultTemplate,
    defaultKnowledgeBase = '',
    showChatApiSettings,
}) => {
    const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
    const [knowledgeBase, setKnowledgeBase] = useState('');
    const [template, setTemplate] = useState(defaultTemplate || '');
    const [chatApiSettings, setChatApiSettings] = useState<ChatApiSettings>(DEFAULT_CHAT_API_SETTINGS);

    // Load from LocalStorage on Open
    useEffect(() => {
        if (isOpen) {
            const saved = localStorage.getItem(configKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                setSystemPrompt(parsed.systemPrompt || defaultSystemPrompt);
                if (Object.prototype.hasOwnProperty.call(parsed, 'knowledgeBase')) {
                    setKnowledgeBase(parsed.knowledgeBase ?? '');
                } else {
                    setKnowledgeBase(defaultKnowledgeBase);
                }
                if (defaultTemplate) {
                    setTemplate(parsed.template || defaultTemplate);
                }
            } else {
                setSystemPrompt(defaultSystemPrompt);
                setKnowledgeBase(defaultKnowledgeBase);
                if (defaultTemplate) setTemplate(defaultTemplate);
            }
            if (showChatApiSettings) {
                setChatApiSettings(loadChatApiSettings());
            }
        }
    }, [isOpen, configKey, defaultSystemPrompt, defaultTemplate, defaultKnowledgeBase, showChatApiSettings]);

    const handleSave = () => {
        const settings = {
            systemPrompt,
            knowledgeBase,
            template: defaultTemplate ? template : undefined
        };
        localStorage.setItem(configKey, JSON.stringify(settings));
        if (showChatApiSettings) {
            saveChatApiSettings(chatApiSettings);
        }
        onClose();
    };

    const handleReset = () => {
        if (window.confirm('确定要恢复到系统默认设置吗？自定义的修改将丢失。')) {
            setSystemPrompt(defaultSystemPrompt);
            setKnowledgeBase(defaultKnowledgeBase);
            if (defaultTemplate) setTemplate(defaultTemplate);
            localStorage.removeItem(configKey);
            if (showChatApiSettings) {
                setChatApiSettings(DEFAULT_CHAT_API_SETTINGS);
                localStorage.removeItem(CHATBOT_API_STORAGE_KEY);
            }
        }
    };

    useEscClose(isOpen, onClose);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div
                className={`bg-white w-full rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden border border-slate-200 ${
                    showChatApiSettings ? 'max-w-3xl' : 'max-w-2xl'
                }`}
            >
                
                {/* Header */}
                <div className="bg-slate-800 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <h3 className="font-bold flex items-center gap-2">
                        <UserCog className="w-5 h-5" />
                        AI 配置: {title}
                    </h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scroll">
                    {showChatApiSettings && (
                        <ChatApiSettingsPanel value={chatApiSettings} onChange={setChatApiSettings} />
                    )}

                    {/* 1. System Persona */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                            <UserCog className="w-4 h-4 text-blue-600" />
                            角色设定 (System Persona)
                        </label>
                        <p className="text-xs text-slate-500">定义 AI 的身份、语气和行为准则。</p>
                        <textarea 
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            className="w-full h-32 p-3 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none font-mono bg-slate-50"
                            placeholder="例如：你是一个拥有10年经验的亚马逊数据分析师..."
                        />
                    </div>

                    {/* 2. Knowledge Base */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                            <BookOpen className="w-4 h-4 text-green-600" />
                            知识库 / 背景上下文 (Knowledge Base)
                        </label>
                        <p className="text-xs text-slate-500">在此粘贴公司特定的 SOP、产品背景或特殊分析规则。这部分内容将作为补充信息始终发送给 AI。</p>
                        <textarea 
                            value={knowledgeBase}
                            onChange={(e) => setKnowledgeBase(e.target.value)}
                            className="w-full min-h-[14rem] h-56 p-3 border border-slate-300 rounded-lg text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none resize-y font-mono bg-slate-50"
                            placeholder="例如：我们的利润率及格线是15%；对于退货率超过5%的产品需要重点标记..."
                        />
                    </div>

                    {/* 3. Template (Optional) */}
                    {defaultTemplate && (
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                                <FileText className="w-4 h-4 text-purple-600" />
                                任务指令模板 (Task Template)
                            </label>
                            <p className="text-xs text-slate-500">
                                定义具体的分析任务。请保留 <span className="font-mono bg-slate-200 px-1 rounded">{'{{DATA}}'}</span> 占位符，系统会自动替换为实际数据。
                            </p>
                            <textarea 
                                value={template}
                                onChange={(e) => setTemplate(e.target.value)}
                                className="w-full h-40 p-3 border border-slate-300 rounded-lg text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none resize-none font-mono bg-slate-50"
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center">
                    <button 
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-red-600 text-sm font-medium transition-colors"
                    >
                        <RotateCcw className="w-4 h-4" />
                        恢复默认
                    </button>
                    <div className="flex gap-3">
                        <button 
                            onClick={onClose}
                            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleSave}
                            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md transition-all active:scale-95"
                        >
                            <Save className="w-4 h-4" />
                            保存配置
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Helper function to get current settings
export const getActivePromptSettings = (
    configKey: string,
    defaultSystem: string,
    defaultTemplate?: string,
    defaultKnowledgeBase?: string
) => {
    const appendKb = (system: string, kbRaw: string) => {
        const block = kbRaw.trim() ? kbRaw : '无';
        return `${system}\n\n【补充知识库/Context】:\n${block}`;
    };

    const saved = localStorage.getItem(configKey);
    if (!saved) {
        const kb = defaultKnowledgeBase?.trim() ? defaultKnowledgeBase : '';
        return {
            system: kb ? appendKb(defaultSystem, kb) : defaultSystem,
            template: defaultTemplate
        };
    }

    const parsed = JSON.parse(saved);
    const sys = parsed.systemPrompt || defaultSystem;
    let kb: string;
    if (Object.prototype.hasOwnProperty.call(parsed, 'knowledgeBase')) {
        kb = String(parsed.knowledgeBase ?? '');
    } else {
        kb = defaultKnowledgeBase ?? '';
    }
    return {
        system: appendKb(sys, kb),
        template: parsed.template || defaultTemplate
    };
};
