
import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { X, Upload, MessageSquare, Star, Sparkles, Loader2, Search, Filter, ThumbsUp, ThumbsDown, Bot, Settings, Trash2, Save, RotateCcw, AlertCircle, AlertTriangle, ChevronDown, CheckSquare, Square, Grid, Plus, SortAsc, SortDesc, Cloud, Languages, Calendar, Heart, TrendingUp, Layers, Table, PauseCircle, PlayCircle, ExternalLink, Check, Download } from 'lucide-react';
import { parseReviewData } from '../dataLoader';
import { ReviewRow, DataRow, FilterState } from '../types';
import { formatNumber, formatPercent } from '../utils';
import { PromptSettingsModal, getActivePromptSettings } from './PromptSettingsModal';
import { hasConfiguredAiApi, unifiedGenerateContent, AI_API_SETUP_HINT } from './aiUnifiedGenerate';

interface ReviewAnalysisModalProps {
    isOpen: boolean;
    onClose: () => void;
    reviewData: ReviewRow[];
    rawPerformance?: DataRow[]; 
    onDataChange: (data: ReviewRow[]) => void;
    initialFilters?: FilterState;
}

const MASSIVE_REVIEW_ISSUES: Record<string, string[]> = {
    "1. 价值：浪费钱/智商税": ["waste of money", "not worth it", "waste of time", "garbage", "trash", "rip off", "money down the drain", "don't buy", "scam", "geldverschwendung", "perte d'argent", "soldi buttati", "dinero tirado", "overpriced", "expensive for what it is", "do not recommend", "waste", "throwing money away"],
    "2. 质量：极差/垃圾": ["poor quality", "bad quality", "cheap quality", "terrible quality", "horrible", "junk", "piece of junk", "flimsy", "crappy", "schlechte qualität", "mauvaise qualité", "pessima qualità", "mala calidad", "low quality", "inferior quality", "fell apart", "cheap material", "worst quality"],
    "3. 功能：根本没用/失效": ["doesn't work", "didn't work", "useless", "does nothing", "failed", "not working", "complete failure", "dysfunctional", "funktioniert nicht", "inutile", "ne marche pas", "non funziona", "no funciona", "defective", "broken on arrival", "dead on arrival", "stopped working"],
    "4. 准确性：刻度看不清": ["hard to read", "impossible to read", "blurry numbers", "tiny numbers", "can't see lines", "illegible", "unreadable", "unleserlich", "illisible", "non leggibile", "ilegible", "print too small", "faded numbers", "contrast poor", "faint lines"],
    "5. 准确性：测量完全不准": ["inaccurate", "not accurate", "wrong size indicated", "off scale", "misleading measurements", "false reading", "ungenau", "pas précis", "non preciso", "inexacto", "wrong measurement", "sizing off", "calibration off", "incorrect size", "not true size"],
    "6. 粘性：粘不住/掉落": ["doesn't stick", "fell off", "fell down", "adhesive weak", "glue dried out", "won't stay", "keeps falling", "hält nicht", "ne tient pas", "non attacca", "no pega", "suction cup failed", "peeled off", "came loose", "bad adhesive", "not sticky"],
    "7. 气味：化学毒气/恶臭": ["chemical smell", "strong chemical odor", "smells like gas", "toxic smell", "disgusting smell", "fishy smell", "stinks", "geruch", "odeur chimique", "puzza", "olor químico", "unbearable smell", "weird smell", "strong scent", "smells bad"],
    "8. 材质：廉价塑料感": ["cheap plastic", "hard plastic", "flimsy plastic", "brittle", "feels cheap", "toy quality", "plastico", "billiges plastik", "plastoc", "dollar store quality", "like a toy", "thin plastic", "poor material", "feels fake"],
    "9. 尺寸：严重偏小/穿不上": ["way too small", "tiny", "child size", "doll size", "can't fit", "cut off circulation", "much smaller than described", "viel zu klein", "minuscule", "troppo piccolo", "muy pequeño", "baby size", "runs very small", "squeeze", "tight"],
    "10. 尺寸：严重偏大/松垮": ["way too big", "huge", "massive", "swimming in it", "falls off", "loose fit", "baggy", "shapeless", "viel zu groß", "immense", "troppo grande", "enorme", "runs very big", "oversized", "gigantic", "tent like"],
    "11. 耐用性：用一次就坏": ["broke immediately", "broke first time", "one use only", "fell apart", "snapped", "cracked", "lasted 5 minutes", "kaputt gegangen", "cassé tout de suite", "rotto subito", "se rompió", "not durable", "broke after one use", "poor durability", "didn't last"],
    "12. 舒适度：硬得像砖头": ["rock hard", "brick", "hard as rock", "stone", "too stiff", "hurts my neck", "ear pain", "headache", "no give", "zu hart", "dur comme de la pierre", "troppo duro", "muy duro", "uncomfortable", "stiff neck", "causing pain", "like concrete"],
    "13. 舒适度：毫无支撑/塌陷": ["too soft", "pancake", "flat", "no support", "sinks to bottom", "flimsy", "paper thin", "useless pillow", "zu weich", "trop mou", "troppo morbido", "muy blando", "goes flat", "no neck support", "squishy", "sinks in"],
    "14. 舒适度：磨脚/疼痛": ["hurts feet", "blisters", "cuts into heel", "painful to wear", "uncomfortable", "rubbing", "schmerzen", "fait mal", "fa male", "duele", "chaffing", "rub raw", "heel pain", "toe pain", "agonizing"],
    "15. 设计：难以操作/反人类": ["hard to use", "difficult to use", "confusing", "impossible to open", "tricky", "frustrating", "bad design", "schwer zu bedienen", "difficile", "difficile da usare", "difícil de usar", "user unfriendly", "poorly designed", "nightmare to use", "complicated"],
    "16. 视觉：货不对板/欺诈": ["not as described", "doesn't look like picture", "wrong color", "misleading photos", "catfished", "false advertising", "anders als abgebildet", "non conforme", "diverso da foto", "diferente", "different product", "looks different", "scam", "misleading description"],
    "17. 螺丝：无法拧开/滑丝": ["screws stuck", "can't unscrew", "stripped screws", "screws loose", "screw missing", "les vis", "schrauben", "vite", "tornillos", "hard to unscrew", "stuck tight", "screw head stripped", "impossible to remove", "seized screws"],
    "18. 镜面：模糊/变形": ["blurry", "distorted", "fun house mirror", "can't see clearly", "foggy", "distortion", "unscharf", "flou", "sfocato", "borroso", "bad reflection", "warped image", "poor visibility", "unclear", "dizzying"],
    "19. 拉链：卡顿/爆裂": ["zipper broke", "zipper stuck", "cheap zipper", "zipper split", "broken zip", "reißverschluss kaputt", "fermeture cassée", "cerniera rotta", "cremallera rota", "zipper derailed", "stuck zipper", "zip fail", "weak zipper", "zipper separated"],
    "20. 包装：破损/二手嫌疑": ["box damaged", "arrived open", "used item", "dirty", "hair inside", "repackaged", "crushed box", "previously returned", "gebraucht", "usato", "usado", "opened package", "dusty", "fingerprints", "stained", "gross"],
    "21. 缺件：配件缺失": ["missing parts", "incomplete", "missing screws", "only received one", "not a set", "fehlt", "incomplet", "mancante", "falta", "didn't receive all", "missing piece", "short item", "not full set", "where is the rest"],
    "22. 安装：无法安装/不适配": ["doesn't fit car", "incompatible", "can't install", "won't mount", "wrong model", "passt nicht", "ne s'adapte pas", "non compatibile", "no compatible", "hard to install", "mounting issue", "fitment issue", "wrong size for car"],
    "23. 物流：永远没收到/丢件": ["never arrived", "lost package", "never received", "scam seller", "wo ist mein paket", "jamais reçu", "mai arrivato", "no llegó", "missing package", "stolen", "undelivered", "where is my stuff", "tracking stopped"],
    "24. 物流：严重延迟": ["arrived too late", "took forever", "months to arrive", "missed deadline", "delayed", "zu spät", "retard", "ritardo", "retraso", "slow shipping", "long wait", "delivery late", "arrived after event", "slow delivery"],
    "25. 推荐：千万别买": ["do not buy", "stay away", "avoid", "zero stars", "worst purchase", "warnung", "à fuir", "da evitare", "no comprar", "regret buying", "horrible product", "terrible experience", "save your money", "beware"],
    "26. 服务：无人回应": ["no response", "terrible customer service", "seller ignored me", "can't contact", "rude", "kein service", "pas de réponse", "nessuna risposta", "sin respuesta", "bad seller", "unhelpful", "impossible to contact", "ignored emails"],
    "27. 材质：面料粗糙/扎人": ["rough", "scratchy", "itchy", "cheap fabric", "abrasive", "sandpaper", "kratzig", "gratte", "ruvido", "aspero", "skin irritation", "uncomfortable fabric", "stiff material", "hurts skin", "feels like cardboard"],
    "28. 稳定性：抖动/不稳": ["vibrates", "shakes", "wobbles", "unstable", "falls out of position", "wackelt", "tremble", "vibra", "tiembla", "vibration", "won't stay put", "loose", "shaking mirror", "jittery"],
    "29. 安全隐患：危险/锋利": ["dangerous", "sharp edges", "cut my hand", "safety hazard", "unsafe", "scharf", "dangereux", "pericoloso", "peligroso", "cut finger", "sharp plastic", "injury", "hurt myself", "jagged edges"],
    "30. 描述：说明书缺失/看不懂": ["no instructions", "no manual", "chinese instructions only", "confusing guide", "keine anleitung", "pas de notice", "senza istruzioni", "sin instrucciones", "poorly written", "bad english", "instructions missing", "how to use"]
};

// --- Helper Functions & Components ---

const identifyReviewCluster = (title: string, content: string, rules: Record<string, string[]>): string => {
    const text = `${title} ${content}`.toLowerCase();
    for (const [cluster, keywords] of Object.entries(rules)) {
        if (keywords.some(k => text.includes(k.toLowerCase()))) return cluster;
    }
    return '其他/一般吐槽';
};

const extractKeywords = (reviews: ReviewRow[]): { word: string, count: number }[] => {
    const text = reviews.map(r => `${r.title} ${r.content}`).join(' ').toLowerCase();
    const words = text.split(/[\s,.!?;:()"]+/);
    const stopWords = new Set(['the','and','a','to','of','in','i','is','that','it','for','was','my','with','on','this','but','not','are','have','as','you','be','so','at','very','just','like','from','or','an','one','all','me','we','they','had','if','would','can','about','when','up','no','out','get','use','what','time','which','go','do','will','really','item','product','buy','bought','good','great','love','loves','return','returned','work','works','don\'t','didn\'t','does','doesn\'t']);
    
    const counts: Record<string, number> = {};
    words.forEach(w => {
        if (w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w)) {
            counts[w] = (counts[w] || 0) + 1;
        }
    });

    return Object.entries(counts)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
};

const HeatmapTable = ({ rows, cols, data }: { rows: string[], cols: string[], data: Record<string, Record<string, number>> }) => (
    <div className="overflow-auto custom-scroll h-full">
        <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                <tr><th className="p-2 border border-slate-200 min-w-[100px] text-slate-500 font-normal bg-slate-50">品名 \ 痛点</th>{cols.map(c => <th key={c} className="p-2 border border-slate-200 text-slate-700 font-semibold min-w-[60px] truncate max-w-[80px] bg-slate-50" title={c}>{c.split('(')[0]}</th>)}</tr>
            </thead>
            <tbody>
                {rows.map(r => (
                    <tr key={r} className="hover:bg-slate-50/50">
                        <td className="p-2 border border-slate-200 font-medium text-slate-700 truncate max-w-[120px] bg-white sticky left-0 z-10" title={r}>{r}</td>
                        {cols.map(c => {
                            const val = data[r]?.[c] || 0;
                            const rowMax = Math.max(...cols.map(col => data[r]?.[col] || 0)) || 1;
                            const opacity = val > 0 ? (val / rowMax) * 0.8 + 0.1 : 0;
                            return ( <td key={c} className="p-1 border border-slate-200 text-center relative">{val > 0 ? ( <div className="w-full h-8 rounded bg-red-500 flex items-center justify-center text-white font-bold shadow-sm" style={{ backgroundColor: `rgba(239, 68, 68, ${opacity})`, color: opacity > 0.5 ? 'white' : '#7f1d1d' }}><span className="z-10 relative">{val}</span></div> ) : ( <span className="text-slate-200">-</span> )}</td> );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const RobustTrendChart = ({ data, colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'], focusKey }: { data: Record<string, Record<string, number>>, colors?: string[], focusKey?: string | null }) => {
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const seriesKeys = Object.keys(data);
    if (seriesKeys.length === 0) return <div className="flex items-center justify-center h-full text-xs text-slate-400">无数据</div>;
    
    // Collect all unique months across all series
    const allMonthsSet = new Set<string>();
    Object.values(data).forEach(series => { Object.keys(series).forEach(m => { if (/^\d{4}-\d{2}$/.test(m)) allMonthsSet.add(m); }); });
    let sortedMonths = Array.from(allMonthsSet).sort();
    
    // Fill gaps
    if (sortedMonths.length > 1) {
        const start = new Date(sortedMonths[0] + "-01");
        const end = new Date(sortedMonths[sortedMonths.length - 1] + "-01");
        const filled = [];
        let curr = new Date(start);
        while (curr <= end) {
            const mStr = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, '0')}`;
            filled.push(mStr);
            curr.setMonth(curr.getMonth() + 1);
        }
        sortedMonths = filled;
    }
    
    if (sortedMonths.length === 0) return <div className="flex items-center justify-center h-full text-xs text-slate-400">无有效时间数据</div>;
    
    let globalMax = 0;
    const seriesPoints: Record<string, number[]> = {};
    seriesKeys.forEach(key => {
        seriesPoints[key] = sortedMonths.map(m => {
            const val = data[key][m] || 0;
            if (val > globalMax) globalMax = val;
            return val;
        });
    });
    
    const yMax = globalMax > 0 ? globalMax * 1.1 : 5; 
    const W = 1000; const H = 300; const PADDING_Y = 20; const GRAPH_H = H - PADDING_Y * 2;
    const getX = (idx: number) => (idx / (sortedMonths.length - 1 || 1)) * W;
    const getY = (val: number) => H - PADDING_Y - ((val / yMax) * GRAPH_H);
    
    const paths = seriesKeys.map((key, i) => {
        const points = seriesPoints[key].map((val, idx) => `${getX(idx).toFixed(1)},${getY(val).toFixed(1)}`);
        const d = `M ${points.join(' L ')}`;
        const areaD = `${d} L ${W},${H} L 0,${H} Z`;
        return { key, d, areaD, color: colors[i % colors.length], points: seriesPoints[key] };
    });

    return (
        <div className="w-full h-full flex flex-col">
            <div className="flex-1 relative w-full overflow-hidden select-none" onMouseLeave={() => setHoverIndex(null)}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                    <line x1="0" y1={getY(0)} x2={W} y2={getY(0)} stroke="#f1f5f9" strokeWidth="2" />
                    <line x1="0" y1={getY(yMax/2)} x2={W} y2={getY(yMax/2)} stroke="#f1f5f9" strokeWidth="2" strokeDasharray="5,5"/>
                    <line x1="0" y1={getY(yMax)} x2={W} y2={getY(yMax)} stroke="#f1f5f9" strokeWidth="2" />
                    {paths.map((p, idx) => {
                        const isFocused = !focusKey || focusKey === p.key;
                        const opacity = isFocused ? 1 : 0.1;
                        return (
                            <g key={p.key} style={{ opacity, transition: 'opacity 0.3s' }}>
                                <path d={p.areaD} fill={p.color} fillOpacity="0.05" stroke="none" />
                                <path d={p.d} fill="none" stroke={p.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="drop-shadow-sm" />
                                {hoverIndex !== null && isFocused && ( <circle cx={getX(hoverIndex)} cy={getY(p.points[hoverIndex])} r="5" fill="white" stroke={p.color} strokeWidth="3" /> )}
                            </g>
                        )
                    })}
                    <g className="opacity-0 hover:opacity-100">
                        {sortedMonths.map((_, idx) => ( <rect key={idx} x={getX(idx) - (W / sortedMonths.length / 2)} y="0" width={W / sortedMonths.length} height={H} fill="transparent" onMouseEnter={() => setHoverIndex(idx)} /> ))}
                    </g>
                    {hoverIndex !== null && ( <line x1={getX(hoverIndex)} y1="0" x2={getX(hoverIndex)} y2={H} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4,4" pointerEvents="none" /> )}
                </svg>
                {hoverIndex !== null && (
                    <div className="absolute bg-white/95 backdrop-blur border border-slate-200 shadow-xl rounded-lg p-3 text-xs z-50 pointer-events-none transition-all" style={{ left: `${(hoverIndex / (sortedMonths.length - 1 || 1)) * 100}%`, top: '10%', transform: 'translateX(-50%)' }}>
                        <div className="font-bold text-slate-700 mb-2 border-b border-slate-100 pb-1">{sortedMonths[hoverIndex]}</div>
                        <div className="flex flex-col gap-1">
                            {paths.filter(p => !focusKey || focusKey === p.key).map(p => ( <div key={p.key} className="flex items-center gap-2 justify-between min-w-[120px]"><div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor: p.color}}></span><span className="text-slate-600 truncate max-w-[80px]">{p.key}</span></div><span className="font-mono font-bold text-slate-800">{p.points[hoverIndex]}</span></div> ))}
                        </div>
                    </div>
                )}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-2 px-1 font-mono select-none h-4 flex-shrink-0">
                <span>{sortedMonths[0]}</span>{sortedMonths.length > 2 && <span>{sortedMonths[Math.floor(sortedMonths.length/2)]}</span>}{sortedMonths.length > 1 && <span>{sortedMonths[sortedMonths.length-1]}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2 max-h-16 overflow-y-auto custom-scroll flex-shrink-0 px-1">
                {seriesKeys.map((k, i) => {
                    const isFocused = !focusKey || focusKey === k;
                    return ( 
                        <div key={k} className={`flex items-center gap-1.5 text-[10px] cursor-default px-2 py-1 rounded border transition-all ${isFocused ? 'bg-slate-50 border-slate-200' : 'opacity-30 border-transparent'}`}>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }}></span>
                            <span className="text-slate-600 font-medium truncate max-w-[120px]" title={k}>{k}</span>
                        </div> 
                    )
                })}
            </div>
        </div>
    );
};

const MonthlyStatsTable = ({ data }: { data: Record<string, { count: number, ratingSum: number, dist: number[] }> }) => {
    const months = Object.keys(data).sort().reverse();
    if (months.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col h-[300px]">
             <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" /> 月度趋势 (Monthly Trend)
            </h3>
            <div className="flex-1 overflow-auto custom-scroll">
                <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 sticky top-0">
                        <tr>
                            <th className="p-2 border-b">月份</th>
                            <th className="p-2 border-b text-right">评论数</th>
                            <th className="p-2 border-b text-right">平均分</th>
                            <th className="p-2 border-b text-center">分布 (1-5★)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {months.map(m => {
                            const stats = data[m];
                            const avg = stats.count > 0 ? stats.ratingSum / stats.count : 0;
                            return (
                                <tr key={m} className="hover:bg-slate-50">
                                    <td className="p-2 border-b font-medium">{m}</td>
                                    <td className="p-2 border-b text-right">{stats.count}</td>
                                    <td className="p-2 border-b text-right font-bold text-yellow-600">{avg.toFixed(1)}</td>
                                    <td className="p-2 border-b">
                                        <div className="flex h-2 w-24 mx-auto rounded-full overflow-hidden bg-slate-100">
                                            {stats.dist.map((c, i) => (
                                                <div key={i} style={{ width: `${(c/stats.count)*100}%` }} className={`${i<2?'bg-red-400':(i===2?'bg-yellow-400':'bg-green-400')}`} />
                                            ))}
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    )
};

const ReviewItem = ({ review, highlightCluster, translation, onTranslate, isTranslating }: any) => {
    const cluster = highlightCluster(review.title, review.content);
    return (
        <div className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <div className="flex items-center gap-2">
                        <div className="flex text-yellow-400">
                            {[...Array(5)].map((_, i) => <Star key={i} className={`w-3 h-3 ${i < review.rating ? 'fill-current' : 'text-slate-200'}`} />)}
                        </div>
                        <span className="text-xs font-bold text-slate-700">{review.title}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 flex gap-2">
                        <span>{review.date}</span>
                        <span>|</span>
                        <span>{review.product_name}</span>
                        {cluster !== '其他/一般吐槽' && <span className="text-red-500 font-bold bg-red-50 px-1 rounded">{cluster.split('：')[1] || cluster}</span>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {review.helpful_votes > 0 && <span className="text-[10px] text-slate-500 flex items-center gap-1"><ThumbsUp className="w-3 h-3" /> {review.helpful_votes}</span>}
                    <a href={review.review_link || '#'} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-blue-500"><ExternalLink className="w-3.5 h-3.5" /></a>
                </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">{review.content}</p>
            {translation && (
                <div className="mt-2 p-2 bg-blue-50 text-blue-800 text-xs rounded border border-blue-100">
                    <div className="font-bold mb-1 flex items-center gap-1"><Languages className="w-3 h-3" /> 翻译:</div>
                    {translation}
                </div>
            )}
            {!translation && (
                <button 
                    onClick={() => onTranslate(review.id, review.content)}
                    disabled={isTranslating}
                    className="mt-2 text-[10px] text-blue-500 hover:underline flex items-center gap-1"
                >
                    {isTranslating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
                    翻译
                </button>
            )}
        </div>
    );
};

// --- MultiSelect Component ---
interface MultiSelectProps {
    label: string;
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

const MultiSelectDropdown: React.FC<MultiSelectProps> = ({ label, options, selected, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    const filteredOptions = useMemo(() => {
        if (!searchTerm) return options;
        return options.filter(o => o.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [options, searchTerm]);

    const handleSelect = (val: string) => {
        if (selected.includes(val)) {
            onChange(selected.filter(s => s !== val));
        } else {
            onChange([...selected, val]);
        }
    };

    const handleSelectAll = () => {
        const targets = searchTerm ? filteredOptions : options;
        const allSelected = targets.every(t => selected.includes(t));
        if (allSelected) {
            onChange(selected.filter(s => !targets.includes(s)));
        } else {
            onChange(Array.from(new Set([...selected, ...targets])));
        }
    };

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    return (
        <div className="relative min-w-[140px]" ref={containerRef}>
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between bg-white border rounded-lg px-3 py-2 text-sm transition-all
                    ${isOpen ? 'border-yellow-500 ring-1 ring-yellow-500' : 'border-slate-200 hover:border-slate-300'}
                `}
            >
                <span className="truncate max-w-[120px] text-slate-700">
                    {selected.length === 0 ? label : `${label} (${selected.length})`}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 ml-2" />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 flex flex-col max-h-80">
                    <div className="p-2 border-b border-slate-100 flex-shrink-0 bg-slate-50 rounded-t-lg">
                        <div className="relative mb-2">
                            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                            <input 
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-white border border-slate-200 rounded px-8 py-1.5 text-xs focus:border-yellow-500 focus:outline-none"
                                placeholder="搜索..."
                                autoFocus
                            />
                        </div>
                        <div className="flex justify-between px-1">
                            <button onClick={handleSelectAll} className="text-[10px] text-yellow-600 hover:underline">
                                {searchTerm ? '全选结果' : '全选'}
                            </button>
                            <button onClick={() => onChange([])} className="text-[10px] text-slate-400 hover:text-red-500 hover:underline">
                                清空
                            </button>
                        </div>
                    </div>
                    <div className="overflow-y-auto custom-scroll p-1 flex-1">
                        {filteredOptions.length > 0 ? filteredOptions.map(opt => {
                            const isSelected = selected.includes(opt);
                            return (
                                <div 
                                    key={opt}
                                    onClick={() => handleSelect(opt)}
                                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-yellow-50 cursor-pointer rounded text-xs text-slate-700"
                                >
                                    {isSelected ? <CheckSquare className="w-4 h-4 text-yellow-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                                    <span className="truncate" title={opt}>{opt}</span>
                                </div>
                            );
                        }) : (
                            <div className="p-4 text-center text-xs text-slate-400">无结果</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Clustering Settings Modal ---
const ClusteringSettingsModal = ({ isOpen, onClose, onSave, initialRules }: any) => {
    const [rules, setRules] = useState(initialRules);
    const [selectedCategory, setSelectedCategory] = useState<string>(Object.keys(initialRules)[0] || '');
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newKeyword, setNewKeyword] = useState('');

    useEffect(() => {
        if (isOpen) {
            setRules(initialRules);
            setSelectedCategory(Object.keys(initialRules)[0] || '');
        }
    }, [isOpen, initialRules]);

    const handleAddCategory = () => {
        if (newCategoryName && !rules[newCategoryName]) {
            setRules((prev: any) => ({ [newCategoryName]: [], ...prev }));
            setSelectedCategory(newCategoryName);
            setNewCategoryName('');
        }
    };
    const handleDeleteCategory = (cat: string) => {
        if (window.confirm(`确定删除分类 "${cat}" 吗?`)) {
            const newRules = { ...rules };
            delete newRules[cat];
            setRules(newRules);
            if (selectedCategory === cat) setSelectedCategory(Object.keys(newRules)[0] || '');
        }
    };
    const handleAddKeyword = () => {
        if (newKeyword && selectedCategory) {
            setRules((prev: any) => ({ ...prev, [selectedCategory]: [...prev[selectedCategory], newKeyword] }));
            setNewKeyword('');
        }
    };
    const handleDeleteKeyword = (cat: string, keyword: string) => {
        setRules((prev: any) => ({ ...prev, [cat]: prev[cat].filter((k: string) => k !== keyword) }));
    };
    const handleReset = () => {
        if(window.confirm("确定恢复到系统默认规则吗？")) {
            setRules(MASSIVE_REVIEW_ISSUES);
            setSelectedCategory(Object.keys(MASSIVE_REVIEW_ISSUES)[0]);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-4xl h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                <div className="bg-slate-800 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <h3 className="font-bold flex items-center gap-2"><Settings className="w-5 h-5" /> 标签聚类配置</h3>
                    <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <div className="flex-1 flex overflow-hidden">
                    <div className="w-1/3 border-r border-slate-200 bg-slate-50 flex flex-col">
                        <div className="p-3 border-b border-slate-200 bg-white">
                            <div className="flex gap-2">
                                <input className="flex-1 border rounded px-2 py-1 text-xs outline-none focus:border-yellow-500" placeholder="新分类名称..." value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCategory()} />
                                <button onClick={handleAddCategory} className="bg-yellow-600 text-white p-1 rounded hover:bg-yellow-700"><Plus className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scroll">
                            {Object.keys(rules).map(cat => (
                                <div key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-3 cursor-pointer border-b border-slate-100 flex justify-between items-center group ${selectedCategory === cat ? 'bg-white border-l-4 border-l-yellow-600 shadow-sm' : 'hover:bg-slate-100 text-slate-600'}`}>
                                    <span className="text-sm font-medium truncate">{cat}</span>
                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat); }} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col bg-white">
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                            <h4 className="font-bold text-slate-700">{selectedCategory || '请选择分类'}</h4>
                            <span className="text-xs text-slate-400">包含以下任意关键词即命中此分类</span>
                        </div>
                        <div className="p-4 flex-1 overflow-y-auto custom-scroll">
                            {selectedCategory && (
                                <div className="flex flex-wrap gap-2">
                                    {rules[selectedCategory]?.map((kw: string) => (
                                        <div key={kw} className="bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-full text-xs font-medium border border-yellow-100 flex items-center gap-2">
                                            {kw}
                                            <button onClick={() => handleDeleteKeyword(selectedCategory, kw)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                                        </div>
                                    ))}
                                    <div className="flex items-center gap-2">
                                        <input className="border-b border-slate-300 px-2 py-1 text-xs outline-none focus:border-yellow-500 min-w-[100px]" placeholder="添加关键词 (Enter)..." value={newKeyword} onChange={e => setNewKeyword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddKeyword()} autoFocus />
                                        <button onClick={handleAddKeyword} className="text-yellow-600 hover:bg-yellow-50 rounded-full p-1"><Plus className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-between">
                    <button onClick={handleReset} className="flex items-center gap-2 text-slate-500 hover:text-red-600 text-xs font-bold px-3"><RotateCcw className="w-3.5 h-3.5" /> 恢复默认</button>
                    <div className="flex gap-2">
                        <button onClick={onClose} className="px-4 py-2 text-slate-600 text-sm hover:bg-slate-200 rounded">取消</button>
                        <button onClick={() => { onSave(rules); onClose(); }} className="px-6 py-2 bg-yellow-600 text-white text-sm font-bold rounded shadow hover:bg-yellow-700 flex items-center gap-2"><Save className="w-4 h-4" /> 保存配置</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Pain Point Bar Chart ---
const PainPointBarChart = ({ data, colorClass, onBarClick, activeLabel }: { data: { label: string, value: number, percent: number }[], colorClass: string, onBarClick?: (label: string) => void, activeLabel?: string | null }) => (
    <div className="flex flex-col gap-3 h-full overflow-y-auto custom-scroll pr-2 pt-2">
        {data.map((d, i) => (
            <div 
                key={i} 
                className={`w-full group ${onBarClick ? 'cursor-pointer' : ''}`}
                onClick={() => onBarClick && onBarClick(d.label)}
            >
                <div className="flex justify-between text-xs mb-1.5">
                    <span className={`font-medium truncate max-w-[70%] transition-colors ${activeLabel === d.label ? 'text-blue-600 font-bold' : 'text-slate-700'}`} title={d.label}>
                        {d.label}
                    </span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded transition-colors ${activeLabel === d.label ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                        {d.value} ({ (d.percent * 100).toFixed(1) }%)
                    </span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                        className={`h-full rounded-full transition-all duration-500 ${colorClass}`} 
                        style={{ width: `${Math.max(d.percent * 100, 2)}%`, opacity: activeLabel && activeLabel !== d.label ? 0.3 : 1 }}
                    />
                </div>
            </div>
        ))}
    </div>
);

// --- Expert Report Overlay ---
const ExpertReportOverlay = ({ isOpen, onClose, onGenerate, report, isGenerating, onReset }: any) => {
    if (!isOpen) return null;
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    return (
        <div className="fixed inset-0 z-[150] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
            <div className="bg-white w-full max-w-2xl max-h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden">
                <PromptSettingsModal 
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    configKey="review_analysis_settings"
                    title="评论分析配置"
                    defaultSystemPrompt="你是一个亚马逊VOC(Voice of Customer)分析专家。"
                    defaultTemplate={`请分析以下评论数据：\n{{DATA}}\n\n请输出 Markdown 报告：\n1. **舆情综述**: 概括用户对产品的主要情感倾向。\n2. **核心痛点**: 指出用户抱怨最多的问题。\n3. **产品亮点**: 用户最满意的地方。\n4. **改进建议**: 针对痛点的具体优化建议。`}
                />
                <div className="bg-yellow-600 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                    <h3 className="font-bold flex items-center gap-2">
                        <Sparkles className="w-5 h-5" />
                        AI 专家诊断报告
                    </h3>
                    <div className="flex items-center gap-2">
                        {report && (
                            <button onClick={onReset} className="px-2 py-1 bg-yellow-700/50 hover:bg-yellow-700 rounded text-xs flex items-center gap-1 transition-colors mr-2">
                                <RotateCcw className="w-3 h-3" /> 重新分析
                            </button>
                        )}
                        <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 hover:bg-white/20 rounded-full transition-colors" title="配置 Prompt">
                            <Settings className="w-4 h-4" />
                        </button>
                        <button onClick={onClose} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                    </div>
                </div>
                <div className="p-6 overflow-y-auto custom-scroll flex-1">
                    {!report && !isGenerating ? (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-8">
                            <div className="bg-yellow-50 p-4 rounded-full"><Bot className="w-12 h-12 text-yellow-500" /></div>
                            <div>
                                <h4 className="font-bold text-slate-800">准备就绪</h4>
                                <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">AI 将分析当前的评论数据（包含情感倾向、关键词、痛点），并给出改进建议。</p>
                            </div>
                            <button onClick={onGenerate} className="bg-yellow-600 hover:bg-yellow-700 text-white px-6 py-2 rounded-full font-bold shadow-lg transform active:scale-95 transition-all flex items-center gap-2">
                                <Sparkles className="w-4 h-4" /> 生成诊断报告
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {isGenerating ? <div className="flex items-center gap-3 text-yellow-600 font-medium p-4 bg-yellow-50 rounded-lg animate-pulse"><Loader2 className="w-5 h-5 animate-spin" /> 正在深入分析数据模式...</div> : null}
                            {report && <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-100"><div className="whitespace-pre-wrap">{report}</div></div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ReviewAnalysisModal: React.FC<ReviewAnalysisModalProps> = ({ isOpen, onClose, reviewData, rawPerformance, onDataChange, initialFilters }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [aiInsight, setAiInsight] = useState<string>('');
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [showReportOverlay, setShowReportOverlay] = useState(false);
    
    const [isClusteringSettingsOpen, setIsClusteringSettingsOpen] = useState(false);
    const [clusteringRules, setClusteringRules] = useState(MASSIVE_REVIEW_ISSUES); 
    const [sortMode, setSortMode] = useState<'date' | 'helpful'>('date');
    const [activeTrend, setActiveTrend] = useState<string | null>(null);
    const [translations, setTranslations] = useState<Record<string, string>>({});
    const [translatingId, setTranslatingId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const [selectedStars, setSelectedStars] = useState<number[]>([]);
    const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
    const [selectedParentAsins, setSelectedParentAsins] = useState<string[]>([]);
    const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const savedRules = localStorage.getItem('review_clustering_rules');
        if (savedRules) {
            try { setClusteringRules(JSON.parse(savedRules)); } catch(e) { console.error(e); }
        }
    }, []);

    const saveClusteringRules = (newRules: Record<string, string[]>) => {
        setClusteringRules(newRules);
        localStorage.setItem('review_clustering_rules', JSON.stringify(newRules));
    };

    const enhancedReviews = useMemo(() => {
        if (!rawPerformance || rawPerformance.length === 0) return reviewData;
        const cleanAsin = (s: string) => s ? s.trim().toUpperCase() : '';
        const metaMap = new Map<string, { parent: string, name: string }>();
        rawPerformance.forEach(row => {
            const asin = cleanAsin(row.child_asin);
            if (asin) {
                const existing = metaMap.get(asin);
                if (!existing || (!existing.name && row.product_name)) {
                    metaMap.set(asin, { parent: row.parent_asin || 'Unknown', name: row.product_name || row.child_asin });
                }
            }
        });
        return reviewData.map((r, index) => {
            const rAsin = cleanAsin(r.asin);
            const mapped = metaMap.get(rAsin);
            const currentName = r.product_name || '';
            const isAsinName = currentName.startsWith('B0') && currentName.length === 10;
            const finalName = (isAsinName && mapped?.name) ? mapped.name : (currentName || mapped?.name || r.asin);
            return { ...r, id: index.toString(), product_name: finalName, parent_asin: mapped?.parent || r.parent_asin || 'Unknown' };
        });
    }, [reviewData, rawPerformance]);

    const filterOptions = useMemo(() => {
        let filtered = enhancedReviews;
        if (selectedCountries.length > 0) filtered = filtered.filter(r => selectedCountries.includes(r.country || 'Unknown'));
        const countryOpts = Array.from(new Set(enhancedReviews.map(r => r.country || 'Unknown'))).sort();
        const parentAsinOpts = Array.from(new Set(filtered.map(r => r.parent_asin || 'Unknown'))).sort();
        const productOpts = Array.from(new Set(filtered.map(r => r.product_name || 'Unknown'))).sort();
        return { countryOpts, parentAsinOpts, productOpts };
    }, [enhancedReviews, selectedCountries]);

    const dashboardData = useMemo(() => {
        if (enhancedReviews.length === 0) return null;
        const filtered = enhancedReviews.filter(r => {
            if (selectedStars.length > 0 && !selectedStars.includes(r.rating)) return false;
            if (selectedCountries.length > 0 && !selectedCountries.includes(r.country || 'Unknown')) return false;
            if (selectedParentAsins.length > 0 && !selectedParentAsins.includes(r.parent_asin || 'Unknown')) return false;
            if (selectedProducts.length > 0 && !selectedProducts.includes(r.product_name || '')) return false;
            const textContent = `${r.title} ${r.content}`.toLowerCase();
            if (searchTerm && !textContent.includes(searchTerm.toLowerCase())) return false;
            if (selectedKeyword && !textContent.includes(selectedKeyword.toLowerCase())) return false;
            return true;
        });

        if (filtered.length === 0) return { total: 0, avg: 0, distribution: [], painPoints: [], reviews: [], keywords: [], trendByReason: {}, matrix: { rows: [], cols: [], data: {} }, blackList: [], monthlyStats: {} };

        const total = filtered.length;
        const sumRating = filtered.reduce((sum, r) => sum + r.rating, 0);
        const avg = sumRating / total;
        const dist = [0, 0, 0, 0, 0];
        const painPointCounts: Record<string, number> = {};
        const trendByReason: Record<string, Record<string, number>> = {};
        const productMatrix: Record<string, Record<string, number>> = {};
        const productNegatives: Record<string, { total: number, bad: number }> = {};
        const monthlyStats: Record<string, { count: number, ratingSum: number, dist: number[] }> = {};

        filtered.forEach(r => {
            const idx = Math.min(Math.max(Math.floor(r.rating) - 1, 0), 4);
            dist[idx]++;
            const month = r.date ? r.date.substring(0, 7) : 'Unknown';
            if (month !== 'Unknown') {
                if (!monthlyStats[month]) monthlyStats[month] = { count: 0, ratingSum: 0, dist: [0,0,0,0,0] };
                monthlyStats[month].count++;
                monthlyStats[month].ratingSum += r.rating;
                monthlyStats[month].dist[idx]++;
            }
            const pName = r.product_name || 'Unknown';
            if (!productNegatives[pName]) productNegatives[pName] = { total: 0, bad: 0 };
            productNegatives[pName].total++;
            if (r.rating <= 2) productNegatives[pName].bad++;

            if (r.rating <= 3) {
                const cluster = identifyReviewCluster(r.title, r.content, clusteringRules);
                if (cluster !== '其他/一般吐槽') {
                    painPointCounts[cluster] = (painPointCounts[cluster] || 0) + 1;
                    if (month !== 'Unknown') {
                        if (!trendByReason[cluster]) trendByReason[cluster] = {};
                        trendByReason[cluster][month] = (trendByReason[cluster][month] || 0) + 1;
                    }
                    if (!productMatrix[pName]) productMatrix[pName] = {};
                    productMatrix[pName][cluster] = (productMatrix[pName][cluster] || 0) + 1;
                }
            }
        });

        const distribution = dist.map((count, i) => ({ label: `${i+1}星`, value: count, percent: count/total, color: i < 2 ? '#ef4444' : (i === 2 ? '#f59e0b' : '#22c55e') })).reverse();
        const painPoints = Object.entries(painPointCounts).map(([label, value]) => ({ label, value, percent: value / (total || 1) })).sort((a, b) => b.value - a.value).slice(0, 8);
        const keywords = extractKeywords(filtered);
        const sortedReviews = [...filtered].sort((a, b) => sortMode === 'date' ? (b.date || '').localeCompare(a.date || '') : (b.helpful_votes || 0) - (a.helpful_votes || 0));
        
        const topMatrixProducts = Object.entries(productMatrix).map(([p, reasons]) => ({ p, total: Object.values(reasons).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total).slice(0, 8).map(i => i.p);
        const topReasonKeys = new Set(painPoints.map(p => p.label));
        const matrixCols = Array.from(topReasonKeys);
        const blackList = Object.entries(productNegatives).map(([label, stats]) => ({ label, value: stats.bad, percent: stats.total > 0 ? stats.bad / stats.total : 0 })).sort((a, b) => b.percent - a.percent).slice(0, 5);

        return { total, avg, distribution, painPoints, reviews: sortedReviews.slice(0, 100), keywords, trendByReason, matrix: { rows: topMatrixProducts, cols: matrixCols, data: productMatrix }, blackList, monthlyStats };
    }, [enhancedReviews, selectedStars, selectedCountries, selectedParentAsins, selectedProducts, searchTerm, selectedKeyword, clusteringRules, sortMode]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setIsUploading(true);
        setUploadError('');
        try {
            const { data } = await parseReviewData(file);
            if (data.length === 0) setUploadError("文件为空或未识别有效评论");
            else onDataChange(data);
        } catch (err) { setUploadError("解析失败"); } finally { setIsUploading(false); }
    };

    const handleTranslateOne = async (id: string, text: string) => {
        if (!hasConfiguredAiApi()) {
            alert(`请先配置 API Key。${AI_API_SETUP_HINT}`);
            return;
        }
        setTranslatingId(id);
        try {
            const prompt = `Translate the following review to Chinese (Mainland). Return ONLY the translation, no preamble.\n\n${text}`;
            const out = await unifiedGenerateContent({
                contents: prompt,
                geminiModel: 'gemini-3-flash-preview',
            });
            setTranslations(prev => ({ ...prev, [id]: out || '翻译失败' }));
        } catch (e: any) { setTranslations(prev => ({ ...prev, [id]: "翻译请求失败" })); } finally { setTranslatingId(null); }
    };

    const handleTrendBarClick = (label: string) => { setActiveTrend(activeTrend === label ? null : label); };

    const generateAnalysis = async () => {
        if (!hasConfiguredAiApi() || !dashboardData) return;
        setIsGeneratingAi(true);
        setAiInsight('');
        try {
            const topPainPoints = dashboardData.painPoints.map(p => `${p.label} (${p.value}例)`).join(', ');
            const relevantReviews = dashboardData.reviews;
            const titleCounts: Record<string, number> = {};
            relevantReviews.forEach(r => { const t = (r as any).product_name || r.product_title; if (t) titleCounts[t] = (titleCounts[t] || 0) + 1; });
            const sortedTitles = Object.entries(titleCounts).sort((a,b) => b[1] - a[1]);
            const productContext = sortedTitles[0]?.[0] || "未识别商品";
            const sampleReviews = dashboardData.reviews.slice(0, 20).map(r => `[${r.rating}星] ${r.title}: ${r.content}`).join('\n');
            const dataContext = `【商品信息】${productContext}\n【评论统计】总评:${dashboardData.total}, 均分:${dashboardData.avg.toFixed(2)}\n【核心痛点】${topPainPoints}\n【样本】${sampleReviews}`;
            
            const settings = getActivePromptSettings('review_analysis_settings', '', '');
            const finalPrompt = (settings.template || `请分析以下评论数据：\n{{DATA}}\n\n请输出 Markdown 报告`).replace('{{DATA}}', dataContext);
            const text = await unifiedGenerateContent({
                systemInstruction: settings.system,
                contents: finalPrompt,
                geminiModel: 'gemini-3-pro-preview',
                geminiTools: [{ googleSearch: {} }],
            });
            setAiInsight(text || '无内容');
        } catch (e: any) { setAiInsight(`Error: ${e.message}`); } finally { setIsGeneratingAi(false); }
    };

    // --- Export PDF Report ---
    const handleExportReport = async () => {
        if (!reportRef.current) return;
        setIsExporting(true);
        try {
            const canvas = await html2canvas(reportRef.current, { scale: 2, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`舆情分析报告_${new Date().toISOString().slice(0,10)}.pdf`);
        } catch (e) {
            console.error(e);
            alert('导出失败');
        } finally {
            setIsExporting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <ExpertReportOverlay isOpen={showReportOverlay} onClose={() => setShowReportOverlay(false)} onGenerate={generateAnalysis} report={aiInsight} isGenerating={isGeneratingAi} onReset={() => setAiInsight('')} />
            <ClusteringSettingsModal isOpen={isClusteringSettingsOpen} onClose={() => setIsClusteringSettingsOpen(false)} onSave={saveClusteringRules} initialRules={clusteringRules} />
            <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
                <div className="bg-slate-50 w-full h-full max-w-[95vw] max-h-[95vh] rounded-xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                    <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <div className="bg-yellow-500 p-2 rounded-lg"><MessageSquare className="w-5 h-5 text-white" /></div>
                            <div><h2 className="text-xl font-bold tracking-tight">评论舆情分析 (VOC)</h2><p className="text-xs text-yellow-100">Voice of Customer & Sentiment Insights</p></div>
                        </div>
                        <div className="flex items-center gap-4">
                            {dashboardData && (
                                <button 
                                    onClick={handleExportReport}
                                    disabled={isExporting}
                                    className="p-1.5 hover:bg-white/20 rounded-full transition-colors text-yellow-100 hover:text-white disabled:opacity-50"
                                    title="导出舆情分析报告 (PDF)"
                                >
                                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin"/> : <Download className="w-5 h-5" />}
                                </button>
                            )}
                            <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors"><X className="w-6 h-6 text-slate-300" /></button>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 custom-scroll">
                        {!dashboardData ? (
                            <div className="h-full flex flex-col items-center justify-center space-y-8">
                                <div onClick={() => fileInputRef.current?.click()} className="w-full max-w-2xl border-2 border-dashed border-slate-300 hover:border-yellow-500 hover:bg-yellow-50/50 rounded-3xl p-16 flex flex-col items-center cursor-pointer transition-all group bg-white shadow-sm">
                                    <div className="w-20 h-20 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform shadow-inner"><Upload className="w-10 h-10" /></div>
                                    <h3 className="text-2xl font-bold text-slate-800">导入评论报表 (Review Report)</h3>
                                    <p className="text-slate-500 mt-3 text-center max-w-md">支持亚马逊标准 Review 报表，包括 Review Title, Content, Rating, ASIN 等字段。</p>
                                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.csv" onChange={handleFileUpload} />
                                </div>
                                {isUploading && <div className="text-yellow-600 font-medium animate-pulse flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin"/> 正在解析评论数据...</div>}
                                {uploadError && <div className="text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100 flex items-center gap-2"><AlertCircle className="w-4 h-4"/>{uploadError}</div>}
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl border border-slate-200 shadow-sm sticky top-0 z-20">
                                    <div className="flex items-center gap-2 text-slate-500 text-sm font-bold mr-2"><Filter className="w-4 h-4" /> 筛选:</div>
                                    <MultiSelectDropdown label="国家" options={filterOptions.countryOpts} selected={selectedCountries} onChange={setSelectedCountries} />
                                    <MultiSelectDropdown label="父ASIN" options={filterOptions.parentAsinOpts} selected={selectedParentAsins} onChange={setSelectedParentAsins} />
                                    <MultiSelectDropdown label="品名" options={filterOptions.productOpts} selected={selectedProducts} onChange={setSelectedProducts} />
                                    <div className="h-6 w-px bg-slate-200 mx-2"></div>
                                    <div className="flex gap-2">
                                        {[5, 4, 3, 2, 1].map(star => (
                                            <button key={star} onClick={() => setSelectedStars(prev => prev.includes(star) ? prev.filter(s => s !== star) : [...prev, star])} className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 border transition-all ${selectedStars.includes(star) ? 'bg-yellow-500 text-white border-yellow-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{star} <Star className="w-3 h-3 fill-current" /></button>
                                        ))}
                                    </div>
                                    <div className="relative">
                                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                                        <input type="text" placeholder="搜索关键词..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs w-40 focus:outline-none focus:border-yellow-500" />
                                    </div>
                                    <div className="ml-auto flex items-center gap-3">
                                        <button onClick={() => setShowReportOverlay(true)} className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md active:scale-95"><Sparkles className="w-4 h-4" /> AI 舆情报告</button>
                                        <button onClick={() => onDataChange([])} className="text-slate-400 hover:text-red-500 p-2 rounded-full hover:bg-slate-100 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between"><div><div className="text-xs text-slate-500 font-bold uppercase">平均评分 (Avg)</div><div className="text-3xl font-bold text-slate-800 mt-1">{dashboardData.avg.toFixed(2)}</div></div><div className="bg-yellow-100 p-3 rounded-full"><Star className="w-6 h-6 text-yellow-600 fill-current" /></div></div>
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between"><div><div className="text-xs text-slate-500 font-bold uppercase">总评论数 (Total)</div><div className="text-3xl font-bold text-slate-800 mt-1">{formatNumber(dashboardData.total)}</div></div><div className="bg-blue-100 p-3 rounded-full"><MessageSquare className="w-6 h-6 text-blue-600" /></div></div>
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between"><div><div className="text-xs text-slate-500 font-bold uppercase">好评率 (4-5★)</div><div className="text-3xl font-bold text-green-600 mt-1">{formatPercent(dashboardData.distribution.filter(d => d.label.includes('5') || d.label.includes('4')).reduce((a,b) => a+b.value, 0) / dashboardData.total)}</div></div><div className="bg-green-100 p-3 rounded-full"><ThumbsUp className="w-6 h-6 text-green-600" /></div></div>
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between"><div><div className="text-xs text-slate-500 font-bold uppercase">差评率 (1-2★)</div><div className="text-3xl font-bold text-red-600 mt-1">{formatPercent(dashboardData.distribution.filter(d => d.label.includes('1') || d.label.includes('2')).reduce((a,b) => a+b.value, 0) / dashboardData.total)}</div></div><div className="bg-red-100 p-3 rounded-full"><ThumbsDown className="w-6 h-6 text-red-600" /></div></div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[340px]">
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col">
                                        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                                            <Grid className="w-4 h-4 text-indigo-500" /> 单品热点图 (Product Heatmap)
                                        </h3>
                                        <div className="flex-1 relative min-h-0">
                                            <HeatmapTable rows={dashboardData.matrix.rows} cols={dashboardData.matrix.cols} data={dashboardData.matrix.data} />
                                        </div>
                                    </div>
                                    
                                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                                        <div className="flex items-center justify-between mb-4 flex-shrink-0">
                                            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                                <AlertTriangle className="w-4 h-4 text-orange-500" /> 关键词标签 (点击查看趋势)
                                            </h4>
                                            <button onClick={() => setIsClusteringSettingsOpen(true)} className="text-slate-400 hover:text-indigo-600 p-1 hover:bg-slate-100 rounded transition-colors"><Settings className="w-3.5 h-3.5" /></button>
                                        </div>
                                        <div className="flex-1 min-h-0">
                                            <PainPointBarChart data={dashboardData.painPoints} colorClass="bg-orange-400" onBarClick={handleTrendBarClick} activeLabel={activeTrend} />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-4 h-full">
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0">
                                            <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2 mb-2 flex-shrink-0">
                                                <Layers className="w-4 h-4 text-slate-600" /> 产品黑榜 (差评率高)
                                            </h4>
                                            <div className="flex-1 min-h-0 overflow-y-auto custom-scroll">
                                                <PainPointBarChart data={dashboardData.blackList} colorClass="bg-slate-600" />
                                            </div>
                                        </div>
                                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col flex-1 min-h-0">
                                            <div className="flex items-center justify-between mb-2 flex-shrink-0">
                                                <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                                                    <Cloud className="w-4 h-4 text-blue-500" /> 高配词云 (Keywords)
                                                </h4>
                                                {selectedKeyword && <button onClick={() => setSelectedKeyword(null)} className="text-xs text-red-500 hover:underline">清除</button>}
                                            </div>
                                            <div className="flex-1 overflow-y-auto custom-scroll flex flex-wrap content-start justify-center gap-2 p-1">
                                                {dashboardData.keywords.map((kw, i) => { const maxCount = dashboardData.keywords[0].count; const sizeClass = kw.count > maxCount * 0.6 ? 'text-sm font-bold' : (kw.count > maxCount * 0.3 ? 'text-xs font-medium' : 'text-[10px]'); const opacity = kw.count > maxCount * 0.6 ? 1 : 0.7; return <span key={kw.word} className={`cursor-pointer transition-all hover:scale-110 select-none ${sizeClass} ${selectedKeyword === kw.word ? 'text-blue-600 underline' : 'text-slate-600 hover:text-blue-500'}`} style={{ opacity }} title={`${kw.count}`} onClick={() => setSelectedKeyword(selectedKeyword === kw.word ? null : kw.word)}>{kw.word}</span> })}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <MonthlyStatsTable data={dashboardData.monthlyStats} />

                                <div className="bg-white p-0 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[600px] overflow-hidden">
                                    <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center flex-shrink-0">
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-bold text-slate-700 text-sm">评论原文透视 ({dashboardData.reviews.length} 条)</h4>
                                            {selectedKeyword && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1">Keyword: {selectedKeyword}</span>}
                                        </div>
                                        <div className="flex bg-white rounded-lg border border-slate-200 p-0.5">
                                            <button onClick={() => setSortMode('date')} className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 transition-all ${sortMode === 'date' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><Calendar className="w-3 h-3" /> 按时间</button>
                                            <button onClick={() => setSortMode('helpful')} className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center gap-1 transition-all ${sortMode === 'helpful' ? 'bg-slate-100 text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}><ThumbsUp className="w-3 h-3" /> 按点赞</button>
                                        </div>
                                    </div>
                                    <div className="flex-1 overflow-y-auto custom-scroll p-4 space-y-3">
                                        {dashboardData.reviews.map((r, i) => (<ReviewItem key={i} review={r} highlightCluster={(t: any, c: any) => identifyReviewCluster(t, c, clusteringRules)} translation={translations[(r as any).id]} onTranslate={handleTranslateOne} isTranslating={translatingId === (r as any).id}/>))}
                                        {dashboardData.reviews.length === 0 && <div className="text-center py-12 text-slate-400 text-sm">没有找到符合条件的评论</div>}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Hidden Report Template */}
            <div className="absolute top-0 left-0 -z-50 opacity-0 pointer-events-none">
                <div ref={reportRef} className="w-[800px] bg-white p-10 font-sans text-slate-800">
                    <div className="flex justify-between items-center border-b-2 border-slate-800 pb-4 mb-6">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">舆情分析报告</h1>
                            <div className="text-sm text-slate-500 mt-1">Review & Sentiment Analysis Report</div>
                        </div>
                        <div className="text-right text-xs text-slate-400">
                            <div>生成时间: {new Date().toLocaleDateString()}</div>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg mb-8 grid grid-cols-2 gap-4">
                        <div>
                            <div className="text-xs text-slate-400">筛选国家</div>
                            <div className="font-bold text-sm">{selectedCountries.length > 0 ? selectedCountries.join(', ') : '全部'}</div>
                        </div>
                        <div>
                            <div className="text-xs text-slate-400">筛选ASIN/产品</div>
                            <div className="font-bold text-sm truncate">{selectedParentAsins.length > 0 ? selectedParentAsins[0] + '...' : (selectedProducts.length > 0 ? selectedProducts[0] + '...' : '全部')}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-4 mb-8">
                        <div className="p-4 border rounded-lg text-center">
                            <div className="text-xs text-slate-500 mb-2">平均评分</div>
                            <div className="text-2xl font-bold font-mono text-yellow-600">{dashboardData?.avg.toFixed(2)}</div>
                        </div>
                        <div className="p-4 border rounded-lg text-center">
                            <div className="text-xs text-slate-500 mb-2">总评论数</div>
                            <div className="text-2xl font-bold font-mono">{formatNumber(dashboardData?.total)}</div>
                        </div>
                        <div className="p-4 border rounded-lg text-center">
                            <div className="text-xs text-slate-500 mb-2">好评率 (4-5★)</div>
                            <div className="text-2xl font-bold font-mono text-green-600">
                                {formatPercent(dashboardData?.distribution.filter(d => d.label.includes('5') || d.label.includes('4')).reduce((a,b) => a+b.value, 0) / (dashboardData?.total || 1))}
                            </div>
                        </div>
                        <div className="p-4 border rounded-lg text-center">
                            <div className="text-xs text-slate-500 mb-2">差评率 (1-2★)</div>
                            <div className="text-2xl font-bold font-mono text-red-600">
                                {formatPercent(dashboardData?.distribution.filter(d => d.label.includes('1') || d.label.includes('2')).reduce((a,b) => a+b.value, 0) / (dashboardData?.total || 1))}
                            </div>
                        </div>
                    </div>

                    {aiInsight && (
                        <div className="bg-slate-50 p-6 rounded-lg border border-slate-200 mb-8">
                            <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-purple-500" />
                                AI 专家诊断建议
                            </h3>
                            <div className="prose prose-sm max-w-none text-xs leading-relaxed whitespace-pre-wrap">
                                {aiInsight}
                            </div>
                        </div>
                    )}

                    <div className="mb-8">
                        <h3 className="font-bold text-slate-700 mb-4 border-l-4 border-yellow-500 pl-2">舆情痛点 (Top Complaints)</h3>
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-100 text-slate-600">
                                <tr>
                                    <th className="p-2 border-b">痛点标签</th>
                                    <th className="p-2 border-b text-right">提及次数</th>
                                    <th className="p-2 border-b text-right">占比</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dashboardData?.painPoints.slice(0, 10).map((p, i) => (
                                    <tr key={i}>
                                        <td className="p-2 font-medium">{p.label}</td>
                                        <td className="p-2 text-right font-mono">{p.value}</td>
                                        <td className="p-2 text-right font-mono">{formatPercent(p.percent)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div>
                        <h3 className="font-bold text-slate-700 mb-4 border-l-4 border-blue-500 pl-2">评论样本 (Top Reviews)</h3>
                        <div className="space-y-4">
                            {dashboardData?.reviews.slice(0, 20).map((r, i) => (
                                <div key={i} className="border-b border-slate-100 pb-3 last:border-0">
                                    <div className="flex justify-between mb-1">
                                        <div className="text-[10px] font-bold text-slate-700 truncate max-w-[70%]">{r.title}</div>
                                        <div className="text-[10px] text-yellow-500">{r.rating} 星</div>
                                    </div>
                                    <p className="text-[10px] text-slate-500 line-clamp-2">{r.content}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
};
