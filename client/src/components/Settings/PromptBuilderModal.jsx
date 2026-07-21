import React, { useState } from 'react';

// Helps a non-technical customer get a genuinely good system prompt without
// writing one from scratch: fill in business details, copy a "meta-prompt" out
// to ChatGPT/Gemini/Claude, then paste the AI's answer back in. No backend call
// and no AI credits spent here — this only assembles and copies plain text.
const TONE_OPTIONS = ['Professional & concise', 'Warm & friendly', 'Casual & upbeat', 'Premium & polished'];

const buildMetaPrompt = ({ businessName, industry, questions, tone, afterQualified, extra }) => {
    return `I need a system prompt for a WhatsApp AI sales/qualification chatbot for my business. Here are the details:

- Business name: ${businessName || '[not provided]'}
- Industry / what we sell: ${industry || '[not provided]'}
- Information the chatbot must collect from each customer, in order: ${questions || '[not provided]'}
- Tone of voice: ${tone}
- What should happen once qualification is complete: ${afterQualified || '[not provided]'}
${extra ? `- Additional context: ${extra}` : ''}

Write a clear, well-structured system prompt for this chatbot. Requirements:
1. Open with the chatbot's role and one line of business context.
2. List the qualifying questions to ask ONE AT A TIME, never all at once.
3. Match the tone described above throughout.
4. Give the chatbot a clear instruction for what to do once qualification is complete.
5. Keep it focused — long-winded prompts cost more to run on every reply, so avoid repetition or filler.

Output ONLY the finished system prompt text. No explanation, no markdown, no quotes around it.`;
};

const PromptBuilderModal = ({ isOpen, onClose, onApply }) => {
    const [businessName, setBusinessName] = useState('');
    const [industry, setIndustry] = useState('');
    const [questions, setQuestions] = useState('');
    const [tone, setTone] = useState(TONE_OPTIONS[0]);
    const [afterQualified, setAfterQualified] = useState('');
    const [extra, setExtra] = useState('');
    const [copied, setCopied] = useState(false);
    const [pastedPrompt, setPastedPrompt] = useState('');

    if (!isOpen) return null;

    const metaPrompt = buildMetaPrompt({ businessName, industry, questions, tone, afterQualified, extra });

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(metaPrompt);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    };

    const handleUsePrompt = () => {
        if (!pastedPrompt.trim()) return;
        onApply(pastedPrompt.trim());
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-bl-full pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-1">
                            <i className="fa-solid fa-wand-magic-sparkles text-blue-600 text-xl"></i>
                            <h2 className="text-xl font-bold text-slate-800">Build My Prompt with AI</h2>
                        </div>
                        <p className="text-sm text-slate-500">Fill in your business details, copy the prompt to any AI tool (like ChatGPT), then paste the result back in.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 w-10 h-10 rounded-full flex items-center justify-center transition">
                        <i className="fa-solid fa-times text-lg"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* Step 1 — business details */}
                    <div>
                        <p className="text-xs font-black text-blue-600 uppercase tracking-wider mb-3">Step 1 — Your Business</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Business Name</label>
                                <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Madhavbaug Clinic" className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Industry / What You Sell</label>
                                <input type="text" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Ayurvedic heart clinic" className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">What should the chatbot find out? (in order)</label>
                        <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows="3" placeholder="e.g. Name, city, which condition they want to treat, whether they've consulted before" className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tone</label>
                            <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                                {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">After Qualification, Then What?</label>
                            <input type="text" value={afterQualified} onChange={(e) => setAfterQualified(e.target.value)} placeholder="e.g. Tell them an advisor will call within 30 minutes" className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Anything else the AI should know? (optional)</label>
                        <textarea value={extra} onChange={(e) => setExtra(e.target.value)} rows="2" placeholder="e.g. Never quote exact prices, always mention the free first consultation" className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>

                    {/* Step 2 — copy out */}
                    <div className="pt-1">
                        <p className="text-xs font-black text-blue-600 uppercase tracking-wider mb-3">Step 2 — Generate It</p>
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <p className="text-xs text-slate-500 mb-2">Copy this, paste it into any AI tool (ChatGPT, Gemini, etc.), and send it. Then come back and paste its reply below.</p>
                            <button
                                type="button"
                                onClick={handleCopy}
                                className={`w-full px-4 py-2.5 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2 ${copied ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                            >
                                {copied ? (<><i className="fa-solid fa-check"></i> Copied — go paste it into ChatGPT</>) : (<><i className="fa-regular fa-copy"></i> Copy Prompt for ChatGPT</>)}
                            </button>
                        </div>
                    </div>

                    {/* Step 3 — paste result */}
                    <div>
                        <p className="text-xs font-black text-blue-600 uppercase tracking-wider mb-3">Step 3 — Paste the Result Here</p>
                        <textarea
                            value={pastedPrompt}
                            onChange={(e) => setPastedPrompt(e.target.value)}
                            rows="5"
                            placeholder="Paste the system prompt the AI wrote for you..."
                            className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                    <button onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-sm text-slate-600 border border-slate-200 hover:bg-white transition">Cancel</button>
                    <button
                        onClick={handleUsePrompt}
                        disabled={!pastedPrompt.trim()}
                        className="px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <i className="fa-solid fa-circle-check"></i> Use This Prompt
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PromptBuilderModal;
