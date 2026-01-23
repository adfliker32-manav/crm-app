import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const TemplateBuilder = ({ templateId, onBack }) => {
    const [template, setTemplate] = useState({
        name: '',
        language: 'en',
        category: 'UTILITY',
        components: [
            { type: 'BODY', format: 'TEXT', text: '', example: { body_text: [[]] } }
        ]
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (templateId && templateId !== 'new') {
            fetchTemplate();
        }
    }, [templateId]);

    const fetchTemplate = async () => {
        try {
            setLoading(true);
            const response = await api.get(`/api/whatsapp/templates/${templateId}`);
            setTemplate(response.data);
        } catch (err) {
            setError('Failed to load template');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            setError('');
            setSuccess('');

            // Validate template name
            if (!/^[a-z0-9_]+$/.test(template.name)) {
                setError('Template name must be lowercase with underscores only (e.g., welcome_message)');
                setLoading(false);
                return;
            }

            // Validate body component
            const bodyComponent = template.components.find(c => c.type === 'BODY');
            if (!bodyComponent || !bodyComponent.text) {
                setError('Body text is required');
                setLoading(false);
                return;
            }

            if (templateId && templateId !== 'new') {
                await api.put(`/api/whatsapp/templates/${templateId}`, template);
                setSuccess('Template updated successfully');
            } else {
                await api.post('/api/whatsapp/templates', template);
                setSuccess('Template created successfully');
            }

            setTimeout(() => onBack(), 1500);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to save template');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitToMeta = async () => {
        try {
            setLoading(true);
            setError('');
            setSuccess('');

            await api.post(`/api/whatsapp/templates/${templateId}/submit`);
            setSuccess('Template submitted to Meta for approval');

            setTimeout(() => {
                fetchTemplate();
            }, 1000);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to submit template');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const updateComponent = (type, field, value) => {
        setTemplate(prev => {
            const components = [...prev.components];
            let component = components.find(c => c.type === type);

            if (!component) {
                component = { type, format: 'TEXT' };
                components.push(component);
            }

            component[field] = value;
            return { ...prev, components };
        });
    };

    const removeComponent = (type) => {
        if (type === 'BODY') return; // Body is required
        setTemplate(prev => ({
            ...prev,
            components: prev.components.filter(c => c.type !== type)
        }));
    };

    const addButton = () => {
        setTemplate(prev => {
            const components = [...prev.components];
            let buttonComponent = components.find(c => c.type === 'BUTTONS');

            if (!buttonComponent) {
                buttonComponent = { type: 'BUTTONS', buttons: [] };
                components.push(buttonComponent);
            }

            if (!buttonComponent.buttons) {
                buttonComponent.buttons = [];
            }

            buttonComponent.buttons.push({ type: 'QUICK_REPLY', text: '' });
            return { ...prev, components };
        });
    };

    const updateButton = (index, field, value) => {
        setTemplate(prev => {
            const components = [...prev.components];
            const buttonComponent = components.find(c => c.type === 'BUTTONS');
            if (buttonComponent && buttonComponent.buttons) {
                buttonComponent.buttons[index][field] = value;
            }
            return { ...prev, components };
        });
    };

    const removeButton = (index) => {
        setTemplate(prev => {
            const components = [...prev.components];
            const buttonComponent = components.find(c => c.type === 'BUTTONS');
            if (buttonComponent && buttonComponent.buttons) {
                buttonComponent.buttons.splice(index, 1);
                if (buttonComponent.buttons.length === 0) {
                    return { ...prev, components: components.filter(c => c.type !== 'BUTTONS') };
                }
            }
            return { ...prev, components };
        });
    };

    const getComponent = (type) => template.components.find(c => c.type === type);
    const headerComponent = getComponent('HEADER');
    const bodyComponent = getComponent('BODY');
    const footerComponent = getComponent('FOOTER');
    const buttonComponent = getComponent('BUTTONS');

    const renderPreview = () => {
        return (
            <div className="bg-gradient-to-br from-gray-100 to-gray-200 p-8 rounded-xl flex items-center justify-center min-h-[500px]">
                <div className="w-full max-w-sm">
                    {/* iPhone Mockup */}
                    <div className="bg-black rounded-[3rem] p-3 shadow-2xl">
                        <div className="bg-white rounded-[2.5rem] overflow-hidden">
                            {/* iPhone Notch */}
                            <div className="bg-gray-900 h-8 flex items-center justify-center">
                                <div className="bg-black w-32 h-6 rounded-full"></div>
                            </div>

                            {/* WhatsApp Header */}
                            <div className="bg-[#008069] text-white p-3 flex items-center gap-3">
                                <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                                    <i className="fa-solid fa-user text-gray-600"></i>
                                </div>
                                <div className="flex-1">
                                    <div className="font-semibold">Customer</div>
                                    <div className="text-xs opacity-90">online</div>
                                </div>
                            </div>

                            {/* Chat Area */}
                            <div className="bg-[#efeae2] p-4 min-h-[400px] bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48cGF0dGVybiBpZD0icGF0dGVybiIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiPjxwYXRoIGQ9Ik0wIDUwIEwgNTAgMCBMIDEwMCA1MCBMIDUwIDEwMCBaIiBmaWxsPSJub25lIiBzdHJva2U9IiNkOWQzY2MiIHN0cm9rZS13aWR0aD0iMC41IiBvcGFjaXR5PSIwLjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjcGF0dGVybikiLz48L3N2Zz4=')]">
                                <div className="flex justify-end">
                                    <div className="bg-[#d9fdd3] rounded-lg shadow-sm max-w-[85%] p-3">
                                        {/* Header */}
                                        {headerComponent && headerComponent.text && (
                                            <div className="font-bold text-gray-800 mb-2 pb-2 border-b border-gray-300">
                                                {headerComponent.text}
                                            </div>
                                        )}

                                        {/* Body */}
                                        {bodyComponent && bodyComponent.text && (
                                            <div className="text-gray-800 whitespace-pre-wrap mb-1">
                                                {bodyComponent.text}
                                            </div>
                                        )}

                                        {/* Footer */}
                                        {footerComponent && footerComponent.text && (
                                            <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-300">
                                                {footerComponent.text}
                                            </div>
                                        )}

                                        <div className="text-xs text-gray-500 mt-1 text-right">
                                            12:00 PM
                                        </div>
                                    </div>
                                </div>

                                {/* Buttons */}
                                {buttonComponent && buttonComponent.buttons && buttonComponent.buttons.length > 0 && (
                                    <div className="flex justify-end mt-2">
                                        <div className="bg-white rounded-lg shadow-sm max-w-[85%] overflow-hidden">
                                            {buttonComponent.buttons.map((btn, idx) => (
                                                <div key={idx} className="border-b border-gray-200 last:border-b-0">
                                                    <button className="w-full p-3 text-[#00a5f4] font-medium hover:bg-gray-50 transition text-center">
                                                        {btn.text || `Button ${idx + 1}`}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    if (loading && templateId && templateId !== 'new') {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="text-gray-600 hover:text-gray-800">
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">
                            {templateId && templateId !== 'new' ? 'Edit Template' : 'Create Template'}
                        </h2>
                        {template.status && (
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${template.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
                                    template.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                                        template.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                                            'bg-gray-100 text-gray-800'
                                    }`}>
                                    {template.status}
                                </span>
                                {template.quality && template.quality !== 'UNKNOWN' && (
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${template.quality === 'HIGH' ? 'bg-green-100 text-green-800' :
                                        template.quality === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                            'bg-red-100 text-red-800'
                                        }`}>
                                        Quality: {template.quality}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {template.status === 'DRAFT' && templateId && templateId !== 'new' && (
                        <button
                            onClick={handleSubmitToMeta}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition disabled:opacity-50"
                        >
                            <i className="fa-solid fa-paper-plane mr-2"></i>
                            Submit to Meta
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition disabled:opacity-50"
                    >
                        <i className="fa-solid fa-save mr-2"></i>
                        {loading ? 'Saving...' : 'Save Template'}
                    </button>
                </div>
            </div>

            {/* Alerts */}
            {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 m-4">
                    <div className="flex items-center">
                        <i className="fa-solid fa-exclamation-circle text-red-500 mr-2"></i>
                        <p className="text-red-700">{error}</p>
                    </div>
                </div>
            )}
            {success && (
                <div className="bg-green-50 border-l-4 border-green-500 p-4 m-4">
                    <div className="flex items-center">
                        <i className="fa-solid fa-check-circle text-green-500 mr-2"></i>
                        <p className="text-green-700">{success}</p>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 overflow-hidden flex">
                {/* Form Section */}
                <div className="w-1/2 overflow-y-auto p-6 bg-gray-50">
                    <div className="max-w-2xl space-y-6">
                        {/* Basic Info */}
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">Basic Information</h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Template Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={template.name}
                                        onChange={(e) => setTemplate({ ...template, name: e.target.value.toLowerCase() })}
                                        placeholder="e.g., welcome_message"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                        disabled={template.status !== 'DRAFT' && templateId !== 'new'}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers, and underscores only</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Category *
                                        </label>
                                        <select
                                            value={template.category}
                                            onChange={(e) => setTemplate({ ...template, category: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                            disabled={template.status !== 'DRAFT'}
                                        >
                                            <option value="UTILITY">Utility</option>
                                            <option value="MARKETING">Marketing</option>
                                            <option value="AUTHENTICATION">Authentication</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">
                                            Language *
                                        </label>
                                        <select
                                            value={template.language}
                                            onChange={(e) => setTemplate({ ...template, language: e.target.value })}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                            disabled={template.status !== 'DRAFT'}
                                        >
                                            <option value="en">English</option>
                                            <option value="es">Spanish</option>
                                            <option value="fr">French</option>
                                            <option value="de">German</option>
                                            <option value="pt">Portuguese</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Header Component */}
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">Header (Optional)</h3>
                                {headerComponent && (
                                    <button
                                        onClick={() => removeComponent('HEADER')}
                                        className="text-red-600 hover:text-red-700 text-sm"
                                        disabled={template.status !== 'DRAFT'}
                                    >
                                        <i className="fa-solid fa-trash mr-1"></i>
                                        Remove
                                    </button>
                                )}
                            </div>

                            {!headerComponent ? (
                                <button
                                    onClick={() => updateComponent('HEADER', 'text', '')}
                                    className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-green-500 hover:text-green-600 transition"
                                    disabled={template.status !== 'DRAFT'}
                                >
                                    <i className="fa-solid fa-plus mr-2"></i>
                                    Add Header
                                </button>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Header Text
                                    </label>
                                    <input
                                        type="text"
                                        value={headerComponent.text || ''}
                                        onChange={(e) => updateComponent('HEADER', 'text', e.target.value)}
                                        placeholder="e.g., Welcome to Our Service"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                        disabled={template.status !== 'DRAFT'}
                                        maxLength={60}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Max 60 characters</p>
                                </div>
                            )}
                        </div>

                        {/* Body Component */}
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <h3 className="text-lg font-semibold text-gray-800 mb-4">Body *</h3>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Message Text
                                </label>
                                <textarea
                                    value={bodyComponent?.text || ''}
                                    onChange={(e) => updateComponent('BODY', 'text', e.target.value)}
                                    placeholder="Enter your message here..."
                                    rows={6}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                                    disabled={template.status !== 'DRAFT'}
                                    maxLength={1024}
                                />
                                <p className="text-xs text-gray-500 mt-1">Max 1024 characters. Use {`{{1}}`}, {`{{2}}`} for variables.</p>
                            </div>
                        </div>

                        {/* Footer Component */}
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">Footer (Optional)</h3>
                                {footerComponent && (
                                    <button
                                        onClick={() => removeComponent('FOOTER')}
                                        className="text-red-600 hover:text-red-700 text-sm"
                                        disabled={template.status !== 'DRAFT'}
                                    >
                                        <i className="fa-solid fa-trash mr-1"></i>
                                        Remove
                                    </button>
                                )}
                            </div>

                            {!footerComponent ? (
                                <button
                                    onClick={() => updateComponent('FOOTER', 'text', '')}
                                    className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-green-500 hover:text-green-600 transition"
                                    disabled={template.status !== 'DRAFT'}
                                >
                                    <i className="fa-solid fa-plus mr-2"></i>
                                    Add Footer
                                </button>
                            ) : (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Footer Text
                                    </label>
                                    <input
                                        type="text"
                                        value={footerComponent.text || ''}
                                        onChange={(e) => updateComponent('FOOTER', 'text', e.target.value)}
                                        placeholder="e.g., Powered by YourCompany"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                        disabled={template.status !== 'DRAFT'}
                                        maxLength={60}
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Max 60 characters</p>
                                </div>
                            )}
                        </div>

                        {/* Buttons Component */}
                        <div className="bg-white rounded-lg shadow-sm p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-gray-800">Buttons (Optional)</h3>
                                {buttonComponent && buttonComponent.buttons && buttonComponent.buttons.length > 0 && (
                                    <button
                                        onClick={addButton}
                                        className="text-green-600 hover:text-green-700 text-sm"
                                        disabled={template.status !== 'DRAFT' || buttonComponent.buttons.length >= 3}
                                    >
                                        <i className="fa-solid fa-plus mr-1"></i>
                                        Add Button
                                    </button>
                                )}
                            </div>

                            {!buttonComponent || !buttonComponent.buttons || buttonComponent.buttons.length === 0 ? (
                                <button
                                    onClick={addButton}
                                    className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-green-500 hover:text-green-600 transition"
                                    disabled={template.status !== 'DRAFT'}
                                >
                                    <i className="fa-solid fa-plus mr-2"></i>
                                    Add Button
                                </button>
                            ) : (
                                <div className="space-y-3">
                                    {buttonComponent.buttons.map((btn, idx) => (
                                        <div key={idx} className="p-4 border border-gray-200 rounded-lg">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm font-medium text-gray-700">Button {idx + 1}</span>
                                                <button
                                                    onClick={() => removeButton(idx)}
                                                    className="text-red-600 hover:text-red-700 text-sm"
                                                    disabled={template.status !== 'DRAFT'}
                                                >
                                                    <i className="fa-solid fa-trash"></i>
                                                </button>
                                            </div>
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                                        Button Type
                                                    </label>
                                                    <select
                                                        value={btn.type}
                                                        onChange={(e) => updateButton(idx, 'type', e.target.value)}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                                        disabled={template.status !== 'DRAFT'}
                                                    >
                                                        <option value="QUICK_REPLY">Quick Reply</option>
                                                        <option value="URL">URL</option>
                                                        <option value="PHONE_NUMBER">Phone Number</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                                        Button Text
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={btn.text}
                                                        onChange={(e) => updateButton(idx, 'text', e.target.value)}
                                                        placeholder="Button label"
                                                        className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                                        disabled={template.status !== 'DRAFT'}
                                                        maxLength={20}
                                                    />
                                                </div>
                                                {btn.type === 'URL' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                                            URL
                                                        </label>
                                                        <input
                                                            type="url"
                                                            value={btn.url || ''}
                                                            onChange={(e) => updateButton(idx, 'url', e.target.value)}
                                                            placeholder="https://example.com"
                                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                                            disabled={template.status !== 'DRAFT'}
                                                        />
                                                    </div>
                                                )}
                                                {btn.type === 'PHONE_NUMBER' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-gray-600 mb-1">
                                                            Phone Number
                                                        </label>
                                                        <input
                                                            type="tel"
                                                            value={btn.phone_number || ''}
                                                            onChange={(e) => updateButton(idx, 'phone_number', e.target.value)}
                                                            placeholder="+1234567890"
                                                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                                            disabled={template.status !== 'DRAFT'}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <p className="text-xs text-gray-500">Max 3 buttons</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Preview Section */}
                <div className="w-1/2 border-l border-gray-200 overflow-y-auto">
                    <div className="sticky top-0 bg-white border-b border-gray-200 p-4">
                        <h3 className="text-lg font-semibold text-gray-800">Live Preview</h3>
                        <p className="text-sm text-gray-600">See how your template will appear on WhatsApp</p>
                    </div>
                    {renderPreview()}
                </div>
            </div>
        </div>
    );
};

export default TemplateBuilder;
