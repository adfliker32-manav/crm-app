import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');

// ── Embed code generator ─────────────────────────────────────────────────────
function buildEmbedCode(apiKey, backendUrl) {
    return `<!-- ADFLIKER Web-to-Lead Capture | place before </body> -->
<script>
(function(){
  var ADFLIKER_KEY  = '${apiKey}';
  var ADFLIKER_API  = '${backendUrl}/api/web-leads/capture';

  window.adflikerCaptureLead = function(data) {
    if (!data || !data.name || (!data.phone && !data.email)) {
      console.warn('[Adfliker] name + phone/email required');
      return Promise.reject('missing fields');
    }
    return fetch(ADFLIKER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ADFLIKER_KEY },
      body: JSON.stringify(data)
    })
    .then(function(r){ return r.json(); })
    .then(function(res){
      if (res.success) console.log('[Adfliker] Lead captured ✅');
      else console.warn('[Adfliker] Error:', res.message);
      return res;
    })
    .catch(function(e){ console.error('[Adfliker]', e); });
  };
})();
</script>`.trim();
}

function buildUsageCode() {
    return `<!-- On your form submit button / event -->
<script>
document.getElementById('myLeadForm').addEventListener('submit', function(e) {
  e.preventDefault();
  
  // Call the function with standard and custom fields
  window.adflikerCaptureLead({
    name:        document.getElementById('name').value,
    phone:       document.getElementById('phone').value,
    email:       document.getElementById('email').value,
    message:     document.getElementById('message').value,   // optional
    source:      'Homepage Landing Page',                     // Lead Source / Label
    tag:         'new-campaign',                              // Custom Tag
    customData: { 
       service:  'SEO Optimization',                          // Custom Field
       budget:   '$5,000'                                     // Custom Field
    }
  }).then(function(res) {
    if (res && res.success) {
      alert('Thank you! We will contact you shortly.');
    }
  });
});
</script>`;
}

// ── Main component ─────────────────────────────────────────────────────────
export default function WebLeadSettings() {
    const [apiKey, setApiKey] = useState('');
    const [defaultStage, setDefaultStage] = useState('');
    const [defaultTag, setDefaultTag] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [regenerating, setRegenerating] = useState(false);
    const [copiedSnippet, setCopiedSnippet] = useState(false);
    const [copiedUsage, setCopiedUsage] = useState(false);
    const [copiedKey, setCopiedKey] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);

    const { showDanger } = useConfirm();

    const backendUrl = API || window.location.origin;

    const fetchConfig = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.get('/web-leads/config');
            if (res.data.success) {
                setApiKey(res.data.apiKey || '');
                setDefaultStage(res.data.defaultStage || '');
                setDefaultTag(res.data.defaultTag || '');
            }
        } catch {
            setError('Failed to load Web-to-Lead config');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    const handleRegenerate = async () => {
        const confirmed = await showDanger(
            'Regenerate API key? Any existing snippets on your landing pages will stop working until you update them with the new key.',
            'Rotate API Key'
        );
        if (!confirmed) return;
        
        try {
            setRegenerating(true);
            const res = await api.post('/web-leads/regenerate');
            if (res.data.success) setApiKey(res.data.apiKey);
        } catch { setError('Failed to regenerate key'); }
        finally { setRegenerating(false); }
    };

    const handleSaveConfig = async () => {
        try {
            setSaving(true);
            await api.put('/web-leads/config', { defaultStage, defaultTag });
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch { setError('Failed to save config'); }
        finally { setSaving(false); }
    };

    const copyToClipboard = async (text, type) => {
        try {
            await navigator.clipboard.writeText(text);
            if (type === 'snippet') { setCopiedSnippet(true); setTimeout(() => setCopiedSnippet(false), 2000); }
            if (type === 'usage') { setCopiedUsage(true); setTimeout(() => setCopiedUsage(false), 2000); }
            if (type === 'key') { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }
        } catch { /* clipboard unavailable — ignore */ }
    };

    const snippetCode = apiKey ? buildEmbedCode(apiKey, backendUrl) : '';
    const usageCode = buildUsageCode();

    if (loading) {
        return (
            <div className="flex justify-center items-center py-12">
                <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Header */}
            <div className="border-b border-slate-100 pb-5">
                <h2 className="text-xl font-bold text-slate-800">Web-to-Lead Capture</h2>
                <p className="text-sm text-slate-500 mt-1">Embed a tiny JS snippet on any landing page to instantly push leads to your CRM and trigger automations.</p>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">
                    <i className="fa-solid fa-triangle-exclamation mr-2"></i> {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
                {/* Security Card */}
                <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 flex flex-col">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wider flex items-center">
                        <i className="fa-solid fa-shield-halved mr-2 text-blue-500"></i> API Key Settings
                    </h3>
                    
                    <div className="space-y-4 flex-1 flex flex-col">
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your API Key</label>
                            <div className="flex items-center gap-2">
                                <div className="flex-1 bg-white border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm text-blue-600 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {showKey ? (apiKey || '—') : (apiKey ? '•'.repeat(Math.min(apiKey.length, 30)) : '—')}
                                </div>
                                <button 
                                    onClick={() => setShowKey(!showKey)}
                                    className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-600 px-3 py-2 rounded-lg text-sm transition"
                                >
                                    {showKey ? 'Hide' : 'Show'}
                                </button>
                                <button 
                                    onClick={() => copyToClipboard(apiKey, 'key')}
                                    className={`${copiedKey ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white hover:bg-slate-50 border-slate-300 text-slate-600'} border px-3 py-2 rounded-lg text-sm transition`}
                                >
                                    {copiedKey ? <i className="fa-solid fa-check"></i> : <i className="fa-regular fa-copy"></i>}
                                </button>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-200 mt-auto">
                            <button 
                                onClick={handleRegenerate}
                                disabled={regenerating}
                                className="text-sm text-red-600 hover:text-red-700 font-medium"
                            >
                                <i className="fa-solid fa-rotate mr-1.5"></i> {regenerating ? 'Rotating...' : 'Rotate API Key'}
                            </button>
                            <p className="text-xs text-slate-500 mt-1">
                                Warning: Rotating breaks any existing snippets until you update them.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Default Mapping Card */}
                <div className="bg-slate-50 rounded-xl p-6 border border-slate-200 flex flex-col">
                    <h3 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wider flex items-center">
                        <i className="fa-solid fa-sliders mr-2 text-blue-500"></i> Default Data Mapping
                    </h3>
                    
                    <div className="space-y-4 flex-1 flex flex-col">
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Default Stage</label>
                            <input 
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" 
                                value={defaultStage}
                                onChange={e => setDefaultStage(e.target.value)}
                                placeholder="e.g. New" 
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Default Tag</label>
                            <input 
                                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" 
                                value={defaultTag}
                                onChange={e => setDefaultTag(e.target.value)}
                                placeholder="e.g. landing-page" 
                            />
                        </div>

                        <div className="pt-4 border-t border-slate-200 mt-auto">
                            <button 
                                onClick={handleSaveConfig} 
                                disabled={saving}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition disabled:opacity-50 flex items-center"
                            >
                                {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2"></i> Saving...</> : 'Save Defaults'}
                            </button>
                            {saved && <span className="text-green-600 text-sm ml-3"><i className="fa-solid fa-check mr-1"></i> Saved!</span>}
                        </div>
                    </div>
                </div>
            </div>

            {/* Implementation Steps */}
            <div className="space-y-6">
                <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-2">Implementation Guide</h3>

                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-100 px-5 py-3 border-b border-slate-200 flex justify-between items-center">
                        <div className="font-semibold text-slate-700 text-sm">
                            <span className="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs mr-2">1</span> 
                            Paste this snippet in your landing page (before &lt;/body&gt;)
                        </div>
                        <button 
                            onClick={() => copyToClipboard(snippetCode, 'snippet')}
                            className={`${copiedSnippet ? 'text-green-600' : 'text-blue-600 hover:text-blue-800'} text-sm font-medium transition`}
                        >
                            {copiedSnippet ? <><i className="fa-solid fa-check mr-1"></i> Copied</> : <><i className="fa-regular fa-copy mr-1"></i> Copy snippet</>}
                        </button>
                    </div>
                    <div className="p-4 bg-slate-900 overflow-x-auto">
                        <pre className="text-slate-300 font-mono text-xs leading-relaxed">{snippetCode}</pre>
                    </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-100 px-5 py-3 border-b border-slate-200 flex justify-between items-center">
                        <div className="font-semibold text-slate-700 text-sm">
                            <span className="bg-blue-600 text-white w-6 h-6 rounded-full inline-flex items-center justify-center text-xs mr-2">2</span> 
                            Call the function on your form submit
                        </div>
                        <button 
                            onClick={() => copyToClipboard(usageCode, 'usage')}
                            className={`${copiedUsage ? 'text-green-600' : 'text-blue-600 hover:text-blue-800'} text-sm font-medium transition`}
                        >
                            {copiedUsage ? <><i className="fa-solid fa-check mr-1"></i> Copied</> : <><i className="fa-regular fa-copy mr-1"></i> Copy example</>}
                        </button>
                    </div>
                    <div className="p-4 bg-slate-900 overflow-x-auto">
                        <pre className="text-slate-300 font-mono text-xs leading-relaxed">{usageCode}</pre>
                    </div>
                </div>
            </div>

            {/* Field Reference Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-5 py-4 border-b border-slate-200">
                    <h3 className="font-bold text-slate-700 text-sm">Supported Fields Reference</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                            <tr>
                                <th className="px-5 py-3">Field</th>
                                <th className="px-5 py-3">Required</th>
                                <th className="px-5 py-3">Description</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-600">
                            {[
                                ['name', '✅ Yes', 'Lead\'s full name'],
                                ['phone', 'One of these', 'Phone number (with country code preferred)'],
                                ['email', 'One of these', 'Email address'],
                                ['message', 'No', 'Enquiry / note saved in CRM'],
                                ['source', 'No', 'Label, e.g. "Google Ads", "Homepage"'],
                                ['stage', 'No', 'Override the default stage for this lead'],
                                ['tag', 'No', 'Override the default tag'],
                                ['customData', 'No', 'Object — any extra key/value pairs (custom fields)'],
                            ].map(([f, req, desc]) => (
                                <tr key={f} className="hover:bg-slate-50">
                                    <td className="px-5 py-3 font-mono text-blue-600 text-xs">{f}</td>
                                    <td className="px-5 py-3">
                                        <span className={`px-2 py-1 rounded text-xs font-medium ${req.includes('Yes') ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {req}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-sm">{desc}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {/* Custom Fields Notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex gap-4">
                <i className="fa-solid fa-circle-info text-blue-500 mt-0.5 text-lg"></i>
                <div>
                    <h4 className="font-semibold text-blue-800 text-sm mb-1">Support for Custom Fields & Labels</h4>
                    <p className="text-blue-700 text-sm leading-relaxed">
                        To capture custom fields and labels, simply pass them into the `customData` object (as shown in Step 2). 
                        You can also pass `source` (as a Label) and `tag` directly to categorise the lead. These will automatically appear in the lead's profile in the CRM.
                    </p>
                </div>
            </div>
        </div>
    );
}
