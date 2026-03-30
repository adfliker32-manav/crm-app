import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';

// Multi-select pill dropdown component
function PillMultiSelect({ options, selectedValues, onChange, placeholder, colorKey }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (val) => {
    if (selectedValues.includes(val)) onChange(selectedValues.filter(v => v !== val));
    else onChange([...selectedValues, val]);
  };

  return (
    <div className="relative" ref={ref}>
      <div
        onClick={() => setOpen(o => !o)}
        className="min-h-[36px] w-full flex flex-wrap gap-1 items-center px-2 py-1 border border-slate-200 rounded-lg cursor-pointer bg-white hover:border-teal-400 transition text-sm"
      >
        {selectedValues.length === 0 && <span className="text-slate-400 text-xs">{placeholder}</span>}
        {selectedValues.map(v => {
          const opt = options.find(o => (o.value || o) === v);
          const label = opt?.label || opt?.name || v;
          const color = colorKey && opt?.[colorKey];
          return (
            <span
              key={v}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: color || '#14b8a6' }}
              onClick={e => { e.stopPropagation(); toggle(v); }}
            >
              {label}
              <i className="fa-solid fa-xmark text-[9px]"></i>
            </span>
          );
        })}
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-slate-400 text-xs ml-auto`}></i>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl max-h-44 overflow-y-auto">
          {options.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">No options available</div>}
          {options.map(opt => {
            const val = opt.value || opt.name || opt;
            const label = opt.label || opt.name || opt;
            const color = colorKey && opt[colorKey];
            const selected = selectedValues.includes(val);
            return (
              <div
                key={val}
                onClick={() => toggle(val)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-teal-50 transition ${selected ? 'bg-teal-50' : ''}`}
              >
                {color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }}></span>}
                <span className="text-sm flex-1">{label}</span>
                {selected && <i className="fa-solid fa-check text-teal-500 text-xs"></i>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function SmartLeadSettingsModal({ settings, flowNodes = [], onSave, onClose }) {
  const [localSettings, setLocalSettings] = useState({
    enabled: settings?.enabled || false,
    rules: settings?.rules || [],
    followups: settings?.followups || []
  });
  const [templates, setTemplates] = useState([]);
  const [stages, setStages] = useState([]);
  const [tags, setTags] = useState([]);

  // Extract variable names from Question nodes in the flow
  const flowVariables = (flowNodes || [])
    .filter(n => (n.type === 'question' || n.data?.type === 'question') && (n.data?.variableName || n.data?.data?.variableName))
    .map(n => n.data?.variableName || n.data?.data?.variableName)
    .filter(Boolean);

  useEffect(() => {
    // Fetch approved templates
    api.get('/whatsapp/templates?status=APPROVED')
      .then(res => setTemplates(res.data.templates || []))
      .catch(err => console.error('Templates fetch error:', err));

    // Fetch real CRM pipeline stages
    api.get('/stages')
      .then(res => setStages(res.data || []))
      .catch(err => console.error('Stages fetch error:', err));

    // Fetch real CRM tags
    api.get('/tags')
      .then(res => setTags(res.data || []))
      .catch(err => console.error('Tags fetch error:', err));
  }, []);

  const handleAddRule = () => {
    setLocalSettings({
      ...localSettings,
      rules: [...localSettings.rules, {
        qualificationLevel: 'Partial',
        minQuestionsAnswered: 1,
        requiredVariables: [],
        assignTags: [],
        changeStageTo: ''
      }]
    });
  };

  const handleUpdateRule = (index, field, value) => {
    const newRules = [...localSettings.rules];
    newRules[index] = { ...newRules[index], [field]: value };
    setLocalSettings({ ...localSettings, rules: newRules });
  };

  const handleRemoveRule = (index) => {
    setLocalSettings({ ...localSettings, rules: localSettings.rules.filter((_, i) => i !== index) });
  };

  const handleAddFollowup = () => {
    setLocalSettings({
      ...localSettings,
      followups: [...localSettings.followups, { delayHours: 24, messageType: 'text', messageText: '' }]
    });
  };

  const handleUpdateFollowup = (index, field, value) => {
    const newFollowups = [...localSettings.followups];
    newFollowups[index] = { ...newFollowups[index], [field]: value };
    setLocalSettings({ ...localSettings, followups: newFollowups });
  };

  const handleRemoveFollowup = (index) => {
    setLocalSettings({ ...localSettings, followups: localSettings.followups.filter((_, i) => i !== index) });
  };

  const handleSave = () => {
    const cleanedRules = localSettings.rules.map(rule => ({
      ...rule,
      minQuestionsAnswered: parseInt(rule.minQuestionsAnswered) || 0,
      requiredVariables: Array.isArray(rule.requiredVariables) ? rule.requiredVariables : [],
      assignTags: Array.isArray(rule.assignTags) ? rule.assignTags : []
    }));

    const cleanedFollowups = localSettings.followups.map(f => ({
      ...f,
      delayHours: parseInt(f.delayHours) || 24
    }));

    onSave({ enabled: localSettings.enabled, rules: cleanedRules, followups: cleanedFollowups });
  };

  const levelColors = {
    'Partial': 'bg-amber-400',
    'Engaged': 'bg-blue-500',
    'Qualified': 'bg-teal-500'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-teal-50 to-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500 flex items-center justify-center">
              <i className="fa-solid fa-brain text-white text-sm"></i>
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800">Smart Lead Engine</h2>
              <p className="text-xs text-slate-500">Auto-qualify & follow up based on chatbot answers</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-7">

          {/* Enable Toggle */}
          <div className="flex items-center justify-between bg-teal-50 border border-teal-100 p-4 rounded-xl">
            <div>
              <h3 className="font-bold text-teal-900 text-sm">Enable Smart Lead Engine</h3>
              <p className="text-xs text-teal-700 mt-0.5">Evaluate chatbot answers to auto-qualify and create leads.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={localSettings.enabled}
                onChange={(e) => setLocalSettings({ ...localSettings, enabled: e.target.checked })} />
              <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
            </label>
          </div>

          {localSettings.enabled && (
            <>
              {/* ======= QUALIFICATION RULES ======= */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-black text-slate-800">Qualification Rules</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Set conditions to auto-assign a lead quality level.</p>
                  </div>
                  <button onClick={handleAddRule} className="flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-700 bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-100 hover:bg-teal-100 transition">
                    <i className="fa-solid fa-plus"></i> Add Rule
                  </button>
                </div>

                {localSettings.rules.length === 0 ? (
                  <div className="text-sm text-slate-400 italic p-5 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                    No rules yet. Without rules, no leads will be created automatically.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {localSettings.rules.map((rule, idx) => (
                      <div key={idx} className="relative bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
                        {/* Delete */}
                        <button onClick={() => handleRemoveRule(idx)}
                          className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                          <i className="fa-solid fa-trash text-xs"></i>
                        </button>

                        {/* Level badge */}
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-black text-white px-2 py-0.5 rounded-full ${levelColors[rule.qualificationLevel] || 'bg-slate-400'}`}>
                            {rule.qualificationLevel || 'Partial'}
                          </span>
                          <span className="text-xs text-slate-400">Lead Level</span>
                        </div>

                        {/* Row 1: Level + Min Questions */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Qualify As</label>
                            <select
                              value={rule.qualificationLevel}
                              onChange={(e) => handleUpdateRule(idx, 'qualificationLevel', e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            >
                              <option value="Partial">Partial Lead</option>
                              <option value="Engaged">Engaged Lead</option>
                              <option value="Qualified">Qualified Lead</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Min Questions Answered</label>
                            <input
                              type="number" min="0"
                              value={rule.minQuestionsAnswered}
                              onChange={(e) => handleUpdateRule(idx, 'minQuestionsAnswered', e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            />
                          </div>
                        </div>

                        {/* Required Variables — dropdown from flow */}
                        <div>
                          <label className="block text-xs font-bold text-slate-600 mb-1">
                            Required Variables
                            <span className="ml-1 text-slate-400 font-normal">(must be answered to qualify)</span>
                          </label>
                          {flowVariables.length > 0 ? (
                            <PillMultiSelect
                              options={flowVariables.map(v => ({ value: v, label: v, name: v }))}
                              selectedValues={Array.isArray(rule.requiredVariables) ? rule.requiredVariables : []}
                              onChange={(val) => handleUpdateRule(idx, 'requiredVariables', val)}
                              placeholder="Select variables from your Question nodes..."
                            />
                          ) : (
                            <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2">
                              <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                              No Question nodes found in this flow yet. Add Question nodes first, then come back.
                            </div>
                          )}
                        </div>

                        {/* CRM Actions */}
                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CRM Actions on Qualify</p>
                          <div className="grid grid-cols-2 gap-3">
                            {/* Assign Tags — dynamic dropdown */}
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1">Assign Tags</label>
                              <PillMultiSelect
                                options={tags.map(t => ({ value: t.name, label: t.name, name: t.name, color: t.color }))}
                                selectedValues={Array.isArray(rule.assignTags) ? rule.assignTags : []}
                                onChange={(val) => handleUpdateRule(idx, 'assignTags', val)}
                                placeholder="Pick tags..."
                                colorKey="color"
                              />
                            </div>

                            {/* Change Stage — dynamic from CRM stages */}
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1">Move to Stage</label>
                              <select
                                value={rule.changeStageTo || ''}
                                onChange={(e) => handleUpdateRule(idx, 'changeStageTo', e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                              >
                                <option value="">No Stage Change</option>
                                {stages.map(s => (
                                  <option key={s._id} value={s.name}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <hr className="border-slate-100" />

              {/* ======= FOLLOW-UPS ======= */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="font-black text-slate-800">Automated Follow-ups</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Send messages automatically after user inactivity.</p>
                  </div>
                  <button onClick={handleAddFollowup} className="flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-700 bg-teal-50 px-3 py-1.5 rounded-lg border border-teal-100 hover:bg-teal-100 transition">
                    <i className="fa-solid fa-clock"></i> Add Follow-up
                  </button>
                </div>

                {localSettings.followups.length === 0 ? (
                  <div className="text-sm text-slate-400 italic p-5 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                    No follow-ups set. Sessions will drop off silently.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {localSettings.followups.map((f, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-500 uppercase tracking-wider">
                            <i className="fa-solid fa-clock-rotate-left mr-1 text-teal-500"></i>
                            Follow-up #{idx + 1}
                          </span>
                          <button onClick={() => handleRemoveFollowup(idx)} className="text-slate-300 hover:text-red-500 transition text-xs">
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                          {/* Delay */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Delay (Hours)</label>
                            <input
                              type="number" min="1"
                              value={f.delayHours}
                              onChange={(e) => handleUpdateFollowup(idx, 'delayHours', e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            />
                          </div>

                          {/* Message Type */}
                          <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">Message Type</label>
                            <select
                              value={f.messageType || 'text'}
                              onChange={(e) => handleUpdateFollowup(idx, 'messageType', e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                            >
                              <option value="text">Standard Text</option>
                              <option value="template">WhatsApp Template</option>
                            </select>
                          </div>

                          {/* Template language (only if template) */}
                          {f.messageType === 'template' && (
                            <div>
                              <label className="block text-xs font-bold text-slate-600 mb-1">Language</label>
                              <select
                                value={f.templateLanguage || 'en'}
                                onChange={(e) => handleUpdateFollowup(idx, 'templateLanguage', e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                              >
                                <option value="en">English</option>
                                <option value="en_US">English (US)</option>
                                <option value="hi">Hindi</option>
                                <option value="ar">Arabic</option>
                              </select>
                            </div>
                          )}
                        </div>

                        {/* Message content */}
                        {f.messageType === 'template' ? (
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <label className="block text-xs font-bold text-amber-600">
                                <i className="fa-solid fa-lock mr-1"></i>Approved Template
                              </label>
                              <span className="text-[10px] text-slate-400">Required for messages sent &gt;24h after last reply</span>
                            </div>
                            <select
                              value={f.templateName || ''}
                              onChange={(e) => handleUpdateFollowup(idx, 'templateName', e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-amber-400 focus:border-amber-400 outline-none"
                            >
                              <option value="">— Select an approved template —</option>
                              {templates.map(t => (
                                <option key={t._id} value={t.name}>{t.name} ({t.language})</option>
                              ))}
                            </select>
                            {templates.length === 0 && (
                              <p className="text-[11px] text-red-400 mt-1">No approved templates found. Create and submit templates for Meta approval first.</p>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <label className="block text-xs font-bold text-slate-600">Message Text</label>
                              <span className="text-[10px] text-red-400 font-bold">⚠️ Only works within 24h window</span>
                            </div>
                            <textarea
                              rows="2"
                              placeholder="e.g. Hi! Are you still interested? We'd love to help 😊"
                              value={f.messageText || ''}
                              onChange={(e) => handleUpdateFollowup(idx, 'messageText', e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-teal-500 focus:border-teal-500 outline-none resize-none"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition">
            Cancel
          </button>
          <button onClick={handleSave} className="px-6 py-2 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl shadow-sm transition flex items-center gap-2">
            <i className="fa-solid fa-check"></i>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
