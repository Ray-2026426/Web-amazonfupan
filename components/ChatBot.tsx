
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import { MessageCircle, X, Send, Bot, User, Sparkles, Loader2, Settings } from 'lucide-react';
import { AggregatedData, FilterState, InventoryAggregated, RefundRow, DataRow, InventoryRow } from '../types';
import { formatMoney, formatNumber, formatPercent, filterData, filterInventoryData, formatMoneyNoDecimals } from '../utils';
import { PromptSettingsModal, getActivePromptSettings } from './PromptSettingsModal';
import { DEFAULT_CHATBOT_KNOWLEDGE_BASE } from './defaultChatbotKnowledgeBase';
import {
    loadChatApiSettings,
    getKeyForProvider,
    getDashScopeChatUrl,
    getZhipuChatUrl,
    getDeepSeekChatUrl,
} from './aiApiConfig';
import { streamOpenAICompatibleChat } from './openaiChatStream';

interface ChatBotProps {
    data: {
        current: AggregatedData;
        last: AggregatedData | null;
        year: AggregatedData | null;
        target: AggregatedData;
        periods: any;
        warnings: string[];
    } | null;
    inventory: InventoryAggregated | null; 
    refunds: RefundRow[]; 
    filters: FilterState;
    rawPerformance?: DataRow[]; 
    rawInventory?: InventoryRow[]; 
}

interface Message {
    id: string;
    role: 'user' | 'model';
    text: string;
}

const DEFAULT_SYSTEM_PROMPT = `你是一个亚马逊资深数据与策略分析师 (Amazon Senior Data & Strategy Analyst)。

【核心思维模式】
1. **MECE原则**：分析问题时做到“相互独立，完全穷尽”。
2. **数据驱动**：所有结论必须基于提供的业绩数据（Sales, ACOS, TACoS, CVR, Session等），严禁臆造数据。
3. **差距分析**：始终对比“现状数据”与“目标数据”以及“同环比数据“，找出Gap所在。

【语言风格】
1. **极度理性**：拒绝模糊的形容词（如“大概”、“可能”），使用精准的商业术语。
2. **结构化**：必须使用层级标题、Markdown列表。
3. **直击痛点**：不寒暄，直接切入数据背后的问题。

【任务说明】
你的任务是根据用户提供的【多维数据汇总】（包含负责人、站点、品牌、父ASIN等维度）和【核心单品明细】进行综合诊断。
支持跨维度分析：例如用户问“张三表现如何”，请结合“负责人汇总”表中的数据回答；如果问“美国站哪个品牌卖得好”，请结合站点和品牌数据。`;

export const ChatBot: React.FC<ChatBotProps> = ({ data, inventory, refunds, filters, rawPerformance, rawInventory }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { id: 'init', role: 'model', text: '我是亚马逊资深数据与策略分析师。我已经读取了全维度的报表数据，请直接提出您的问题。' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    
    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isOpen]);

    // --- Helper to extract granular lists from raw data ---
    const getDeepContext = () => {
        let deepContext = "";

        // --- 1. Prepare Filtered Datasets ---
        if (!rawPerformance || rawPerformance.length === 0) return "无原始业绩数据。";

        const [sy, sm, sd] = filters.startDate.split('-').map(Number);
        const [ey, em, ed] = filters.endDate.split('-').map(Number);
        const period = {
            start: new Date(sy, sm - 1, sd),
            end: new Date(ey, em - 1, ed)
        };

        // Filter Performance Data (Respect current view filters)
        const filteredPerformance = filterData(rawPerformance, period, filters);
        
        // Filter Inventory Data
        const filteredInventory = rawInventory ? filterInventoryData(rawInventory, filters) : [];

        // --- 2. Multi-Dimensional Aggregation (The "Cube") ---
        type DimMetrics = { sales: number, profit: number, adSpend: number, qty: number };
        const initMetrics = (): DimMetrics => ({ sales: 0, profit: 0, adSpend: 0, qty: 0 });
        
        const aggs = {
            manager: {} as Record<string, DimMetrics>,
            country: {} as Record<string, DimMetrics>,
            brand: {} as Record<string, DimMetrics>,
            parent: {} as Record<string, DimMetrics>,
            category: {} as Record<string, DimMetrics>
        };

        const updateAgg = (map: Record<string, DimMetrics>, key: string, r: DataRow) => {
            const k = key || 'Unknown';
            if (!map[k]) map[k] = initMetrics();
            map[k].sales += r.sales_amount;
            map[k].profit += r.gross_profit;
            map[k].adSpend += r.ad_spend;
            map[k].qty += r.sales_quantity;
        };

        // Aggregation Pass
        const productAgg: Record<string, { 
            sales: number, qty: number, profit: number, adSpend: number, adSales: number, refundCost: number,
            manager: string, country: string, parent: string
        }> = {};

        filteredPerformance.forEach(r => {
            updateAgg(aggs.manager, r.manager, r);
            updateAgg(aggs.country, r.country, r);
            updateAgg(aggs.brand, r.brand, r);
            updateAgg(aggs.parent, r.parent_asin, r);
            updateAgg(aggs.category, r.sub_category, r);

            // Product Aggregation (for Top List)
            const name = r.product_name || r.child_asin;
            if (!productAgg[name]) {
                productAgg[name] = { 
                    sales: 0, qty: 0, profit: 0, adSpend: 0, adSales: 0, refundCost: 0,
                    manager: r.manager, // Snapshot last seen
                    country: r.country,
                    parent: r.parent_asin
                };
            }
            const p = productAgg[name];
            p.sales += r.sales_amount;
            p.qty += r.sales_quantity;
            p.profit += r.gross_profit;
            p.adSpend += r.ad_spend;
            p.adSales += r.ad_sales;
            p.refundCost += r.refund_cost;
        });

        // --- 3. Generate Markdown Tables for Dimensions ---
        const renderDimTable = (title: string, map: Record<string, DimMetrics>, limit = 20) => {
            const sorted = Object.entries(map).sort((a, b) => b[1].sales - a[1].sales).slice(0, limit);
            if (sorted.length === 0) return "";
            
            let t = `\n【${title}】\nName | Sales | Profit(Margin) | AdSpend(ACoAS)\n---|---|---|---\n`;
            sorted.forEach(([k, v]) => {
                const margin = v.sales > 0 ? (v.profit / v.sales) * 100 : 0;
                const acoas = v.sales > 0 ? (v.adSpend / v.sales) * 100 : 0;
                t += `${k} | $${formatNumber(v.sales)} | $${formatNumber(v.profit)}(${margin.toFixed(1)}%) | $${formatNumber(v.adSpend)}(${acoas.toFixed(1)}%)\n`;
            });
            return t;
        };

        deepContext += renderDimTable("负责人汇总 (Manager)", aggs.manager);
        deepContext += renderDimTable("站点汇总 (Country)", aggs.country);
        deepContext += renderDimTable("品牌汇总 (Brand)", aggs.brand);
        deepContext += renderDimTable("Top 15 父ASIN (Parent)", aggs.parent, 15);

        // --- 4. Inventory Deep Dive (Top aged products) ---
        if (filteredInventory.length > 0) {
            const agedProducts = filteredInventory
                .map(r => ({
                    sku: r.sku,
                    name: r.product_name,
                    agedCost: r.age_181_270_cost + r.age_271_330_cost + r.age_331_365_cost + r.age_365_plus_cost,
                    totalQty: r.fba_total_qty
                }))
                .filter(r => r.agedCost > 0)
                .sort((a, b) => b.agedCost - a.agedCost)
                .slice(0, 10);

            if (agedProducts.length > 0) {
                deepContext += "\n【高风险滞销库存 Top 10 (180天+金额)】:\n";
                agedProducts.forEach(p => {
                    deepContext += `- ${p.name}: $${formatNumber(p.agedCost)}\n`;
                });
            }
        }

        // --- 5. Product Deep Dive (Top 50) ---
        const sortedProducts = Object.entries(productAgg).sort((a, b) => b[1].sales - a[1].sales).slice(0, 50);
        
        deepContext += `\n【核心单品明细 (Top 50)】:\n`;
        deepContext += `格式: 品名 (负责人, 国家, 父ASIN) | 销售额 | 毛利 | 广告费 | ACOS\n`;
        
        sortedProducts.forEach(([name, m]) => {
            const acos = m.adSales > 0 ? (m.adSpend / m.adSales) * 100 : 0;
            // Condensed format to save tokens
            deepContext += `- ${name} (${m.manager},${m.country}) | $${(m.sales/1000).toFixed(1)}k | $${(m.profit/1000).toFixed(1)}k | $${(m.adSpend/1000).toFixed(1)}k | ${acos.toFixed(0)}%\n`;
        });

        return deepContext;
    };

    // Construct the context string from data props
    const getContextData = () => {
        if (!data) return "当前暂无业绩数据，请用户上传 Excel 文件。";

        const formatAgg = (d: AggregatedData | null) => {
            if (!d) return "无数据";
            return JSON.stringify({
                Sales: formatMoney(d.sales_amount),
                Qty: formatNumber(d.sales_quantity),
                Profit: formatMoney(d.gross_profit),
                Margin: formatPercent(d.gross_margin),
                AdSpend: formatMoney(d.ad_spend),
                ACOS: formatPercent(d.ad_sales ? d.ad_spend / d.ad_sales : 0),
            });
        };

        return `
        当前筛选时间: ${filters.startDate} ~ ${filters.endDate}
        
        【1. 全局概览 (Global Summary)】:
        - 本期 (Current): ${formatAgg(data.current)}
        - 上期 (MoM): ${data.last ? formatAgg(data.last) : "无数据"}
        - 目标 (Target): ${formatAgg(data.target)}

        【2. 多维度透视数据 (Multi-Dimensional Deep Dive)】:
        (包含各负责人、站点、品牌、父ASIN的聚合表现，以及Top 50单品详情)
        ${getDeepContext()}
        `;
    };

    const handleSend = async () => {
        if (!input.trim()) return;

        const apiCfg = loadChatApiSettings();
        const apiKey = getKeyForProvider(apiCfg, apiCfg.provider);
        if (!apiKey) {
            setMessages((prev) => [
                ...prev,
                {
                    id: Date.now().toString(),
                    role: 'model',
                    text:
                        '错误：未配置 API Key。请点击右上角设置，在「API 与模型」中为当前选用的服务商填写密钥，或为本机 .env.local 配置 GEMINI_API_KEY（仅 Gemini）。',
                },
            ]);
            return;
        }

        const userMsg: Message = { id: Date.now().toString(), role: 'user', text: input };
        setMessages(prev => [...prev, userMsg]);
        const userText = input;
        setInput('');
        setIsLoading(true);

        const botMsgId = (Date.now() + 1).toString();

        try {
            const settings = getActivePromptSettings(
                'chatbot_settings',
                DEFAULT_SYSTEM_PROMPT,
                undefined,
                DEFAULT_CHATBOT_KNOWLEDGE_BASE
            );

            const systemInstruction = `
            ${settings.system}
            
            以下是当前的数据上下文 (Context Data)：
            ${getContextData()}
            `;

            const priorHistory = messages.slice(1).map((m) => ({
                role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
                content: m.text,
            }));

            setMessages((prev) => [...prev, { id: botMsgId, role: 'model', text: '' }]);

            if (apiCfg.provider === 'gemini') {
                const ai = new GoogleGenAI({ apiKey });
                const modelId = apiCfg.models.gemini;
                const chat: Chat = ai.chats.create({
                    model: modelId,
                    config: {
                        systemInstruction,
                    },
                    history: messages.slice(1).map((m) => ({
                        role: m.role,
                        parts: [{ text: m.text }],
                    })),
                });

                const result = await chat.sendMessageStream({ message: userText });

                let fullText = '';
                for await (const chunk of result) {
                    const chunkText = chunk.text || '';
                    fullText += chunkText;
                    setMessages((prev) =>
                        prev.map((m) => (m.id === botMsgId ? { ...m, text: fullText } : m))
                    );
                }
            } else {
                const openAiMessages = [
                    { role: 'system' as const, content: systemInstruction },
                    ...priorHistory,
                    { role: 'user' as const, content: userText },
                ];
                const url =
                    apiCfg.provider === 'dashscope'
                        ? getDashScopeChatUrl()
                        : apiCfg.provider === 'deepseek'
                          ? getDeepSeekChatUrl()
                          : getZhipuChatUrl();
                const model =
                    apiCfg.provider === 'dashscope'
                        ? apiCfg.models.dashscope
                        : apiCfg.provider === 'deepseek'
                          ? apiCfg.models.deepseek
                          : apiCfg.models.zhipu;
                let fullText = '';
                await streamOpenAICompatibleChat({
                    url,
                    apiKey,
                    model,
                    messages: openAiMessages,
                    onDelta: (t) => {
                        fullText += t;
                        setMessages((prev) =>
                            prev.map((m) => (m.id === botMsgId ? { ...m, text: fullText } : m))
                        );
                    },
                });
            }
        } catch (error) {
            console.error(error);
            const msg =
                error instanceof Error && error.message
                    ? `请求失败：${error.message.slice(0, 400)}`
                    : '抱歉，分析过程中出现了网络错误，请稍后再试。';
            setMessages((prev) =>
                prev.map((m) => (m.id === botMsgId ? { ...m, text: msg } : m))
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* FAB Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`fixed bottom-6 right-6 p-4 rounded-full shadow-xl transition-all duration-300 z-50 flex items-center justify-center
                    ${isOpen ? 'bg-slate-700 rotate-90' : 'bg-blue-600 hover:bg-blue-700 rotate-0'}
                `}
            >
                {isOpen ? <X className="w-6 h-6 text-white" /> : <Sparkles className="w-6 h-6 text-white" />}
            </button>

            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-24 right-6 w-96 h-[600px] max-h-[80vh] bg-white rounded-xl shadow-2xl border border-gray-200 z-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
                    {/* Settings Modal */}
                    <PromptSettingsModal 
                        isOpen={isSettingsOpen}
                        onClose={() => setIsSettingsOpen(false)}
                        configKey="chatbot_settings"
                        title="AI 顾问"
                        defaultSystemPrompt={DEFAULT_SYSTEM_PROMPT}
                        defaultKnowledgeBase={DEFAULT_CHATBOT_KNOWLEDGE_BASE}
                        showChatApiSettings
                    />

                    {/* Header */}
                    <div className="bg-slate-800 p-4 flex items-center justify-between text-white">
                        <div className="flex items-center gap-2">
                            <div className="bg-blue-500 p-1.5 rounded-lg">
                                <Bot className="w-4 h-4 text-white" />
                            </div>
                            <div>
                                <h3 className="font-bold text-sm">业绩报告 AI 顾问</h3>
                                <p className="text-[10px] text-slate-300">资深分析师模式</p>
                            </div>
                        </div>
                        <button 
                            onClick={() => setIsSettingsOpen(true)}
                            className="p-1.5 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white"
                            title="配置 Prompt 与 API"
                        >
                            <Settings className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scroll bg-slate-50">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm
                                    ${msg.role === 'user' 
                                        ? 'bg-blue-600 text-white rounded-br-none' 
                                        : 'bg-white text-slate-800 border border-gray-100 rounded-bl-none'}
                                `}>
                                    {msg.text ? (
                                        <div className="whitespace-pre-wrap">{msg.text}</div>
                                    ) : (
                                        <div className="flex gap-1 items-center h-5">
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                                            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Area */}
                    <div className="p-4 bg-white border-t border-gray-100">
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
                                placeholder="输入您的问题 (例如: 张三负责的美国站产品表现?)..."
                                className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-full pl-4 pr-12 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                                disabled={isLoading}
                            />
                            <button
                                onClick={handleSend}
                                disabled={isLoading || !input.trim()}
                                className="absolute right-2 p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
