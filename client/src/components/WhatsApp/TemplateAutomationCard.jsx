/* eslint-disable no-unused-vars */
import React from 'react';

const TemplateAutomationCard = ({ template, setTemplate, stages }) => {
    return (
        <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-purple-500/10 transition-colors"></div>

            <div className="flex items-center justify-between mb-6">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
                        <i className="fa-solid fa-robot text-xs"></i>
                    </span>
                    Intelligent Automation
                </h3>
                <button
                    onClick={() => setTemplate(prev => ({ ...prev, isAutomated: !prev.isAutomated }))}
                    className={`w-12 h-6 rounded-full transition-all duration-300 relative ${template.isAutomated ? 'bg-purple-600' : 'bg-slate-200 shadow-inner'}`}
                >
                    <div className={`w-5 h-5 bg-white rounded-full shadow-md absolute top-0.5 transition-all duration-300 transform ${template.isAutomated ? 'translate-x-[1.6rem]' : 'translate-x-0.5'}`}></div>
                </button>
            </div>

            {template.isAutomated && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                    <div className="bg-purple-50/50 rounded-2xl p-6 border border-purple-100">
                        <label className="block text-[10px] font-black text-purple-400 uppercase tracking-widest mb-3 px-1">Trigger Event</label>
                        <select
                            value={template.triggerType || 'on_lead_create'}
                            onChange={(e) => setTemplate(prev => ({ ...prev, triggerType: e.target.value }))}
                            className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-purple-500/20 rounded-xl outline-none text-xs font-black text-slate-700 shadow-sm"
                        >
                            <option value="on_lead_create">🆕 New Lead Acquired</option>
                            <option value="on_stage_change">🔄 Pipeline Stage Updated</option>
                        </select>

                        {template.triggerType === 'on_stage_change' && (
                            <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                                <label className="block text-[10px] font-black text-purple-400 uppercase tracking-widest mb-3 px-1">Target Pipeline Stage</label>
                                <select
                                    value={template.stage || ''}
                                    onChange={(e) => setTemplate(prev => ({ ...prev, stage: e.target.value }))}
                                    className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-purple-500/20 rounded-xl outline-none text-xs font-bold text-slate-700 shadow-sm"
                                >
                                    <option value="">Choose a stage...</option>
                                    {stages.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 px-1 italic">This template will be sent automatically when the specified event occurs in your CRM.</p>
                </div>
            )}
        </div>
    );
};

export default React.memo(TemplateAutomationCard);
