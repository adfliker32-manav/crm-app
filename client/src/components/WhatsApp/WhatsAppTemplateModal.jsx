import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const WhatsAppTemplateModal = ({ isOpen, onClose, template, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [formData, setFormData] = useState({
        name: '',
        message: '',
        isActive: true,
        isAutomated: false,
        triggerType: 'manual',
        stage: '',
        isMarketing: false
    });
    const [stages, setStages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [submittingReview, setSubmittingReview] = useState(false);
    const [charCount, setCharCount] = useState(0);
    const charLimit = 1024;
    const marketingCharLimit = 550;

    // Load stages and populate form
    useEffect(() => {
        if (isOpen) {
            fetchStages();
            if (template) {
                setFormData({
                    name: template.name || '',
                    message: template.message || template.body || '',
                    isActive: template.isActive !== false,
                    isAutomated: template.isAutomated || false,
                    triggerType: template.triggerType || 'manual',
                    stage: template.stage || '',
                    isMarketing: template.isMarketing || false
                });
                setCharCount((template.message || template.body || '').length);
            } else {
                // Reset for new template
                setFormData({
                    name: '',
                    message: '',
                    isActive: true,
                    isAutomated: false,
                    triggerType: 'manual',
                    stage: '',
                    isMarketing: false
                });
                setCharCount(0);
            }
        }
    }, [isOpen, template]);

    const fetchStages = async () => {
        try {
            const res = await api.get('/stages');
            setStages(res.data);
        } catch (error) {
            console.error('Error fetching stages:', error);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));

        if (name === 'message') {
            setCharCount(value.length);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.name.trim() || !formData.message.trim()) {
            showError('Please fill in all required fields');
            return;
        }

        const currentLimit = formData.isMarketing ? marketingCharLimit : charLimit;
        if (formData.message.length > currentLimit) {
            showError(`Message exceeds ${currentLimit} character limit`);
            return;
        }

        setLoading(true);

        try {
            const payload = {
                name: formData.name.trim(),
                message: formData.message.trim(),
                isActive: formData.isActive,
                isAutomated: formData.isAutomated,
                triggerType: formData.isAutomated ? formData.triggerType : 'manual',
                stage: (formData.isAutomated && formData.triggerType === 'on_stage_change')
                    ? formData.stage
                    : null,
                isMarketing: formData.isMarketing
            };

            if (template) {
                await api.put(`/whatsapp/templates/${template._id}`, payload);
                showSuccess('Template updated successfully!');
            } else {
                await api.post('/whatsapp/templates', payload);
                showSuccess('Template created successfully!');
            }

            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error saving template:', error);
            showError(error.response?.data?.message || 'Failed to save template');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitForReview = async () => {
        if (!template) return;

        setSubmittingReview(true);
        try {
            await api.post(`/whatsapp/templates/${template._id}/submit-review`);
            showSuccess('Template submitted for review successfully!');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error submitting for review:', error);
            showError(error.response?.data?.message || 'Failed to submit for review');
        } finally {
            setSubmittingReview(false);
        }
    };

    const getReviewStatusBadge = (status) => {
        const badges = {
            draft: { color: 'bg-gray-100 text-gray-700', icon: 'fa-file', text: 'Draft' },
            pending_review: { color: 'bg-yellow-100 text-yellow-700', icon: 'fa-clock', text: 'Pending Review' },
            approved: { color: 'bg-green-100 text-green-700', icon: 'fa-check-circle', text: 'Approved' },
            rejected: { color: 'bg-red-100 text-red-700', icon: 'fa-times-circle', text: 'Rejected' }
        };
        return badges[status] || badges.draft;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 p-6 z-10">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-bold text-gray-800">
                            {template ? 'Edit Template' : 'Create New Template'}
                        </h3>
                        <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition">
                            <i className="fa-solid fa-times text-xl"></i>
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* Template Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Template Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g., Welcome Message"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                            required
                        />
                    </div>

                    {/* Template Type Selection */}
                    <div className="border border-purple-200 bg-purple-50 p-4 rounded-lg space-y-3">
                        <label className="block text-sm font-bold text-gray-800 mb-3">
                            Template Type <span className="text-red-500">*</span>
                        </label>

                        <div className="space-y-2">
                            <label className="flex items-center gap-3 cursor-pointer p-3 bg-white rounded-lg border-2 border-gray-200 hover:border-purple-400 transition">
                                <input
                                    type="radio"
                                    name="isMarketing"
                                    checked={!formData.isMarketing}
                                    onChange={() => setFormData(prev => ({ ...prev, isMarketing: false }))}
                                    className="w-4 h-4 text-purple-600"
                                />
                                <div className="flex-1">
                                    <div className="font-medium text-gray-800">Utility (Transactional)</div>
                                    <div className="text-xs text-gray-500">Order updates, confirmations, reminders</div>
                                </div>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer p-3 bg-white rounded-lg border-2 border-gray-200 hover:border-purple-400 transition">
                                <input
                                    type="radio"
                                    name="isMarketing"
                                    checked={formData.isMarketing}
                                    onChange={() => setFormData(prev => ({ ...prev, isMarketing: true }))}
                                    className="w-4 h-4 text-purple-600"
                                />
                                <div className="flex-1">
                                    <div className="font-medium text-gray-800">Marketing (Promotional)</div>
                                    <div className="text-xs text-gray-500">Offers, campaigns (requires approval, max 550 chars)</div>
                                </div>
                            </label>
                        </div>

                        {/* Hint Text */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                            <div className="flex items-start gap-2">
                                <i className="fa-solid fa-info-circle text-blue-600 mt-0.5"></i>
                                <div className="text-xs text-blue-800">
                                    <strong>Utility:</strong> Transactional messages sent immediately without approval.
                                    <br />
                                    <strong>Marketing:</strong> Promotional messages that require review and approval before use.
                                </div>
                            </div>
                        </div>

                        {/* Review Status (for existing marketing templates) */}
                        {template && formData.isMarketing && template.reviewStatus && (
                            <div className="mt-3">
                                <label className="block text-xs font-medium text-gray-700 mb-2">Review Status</label>
                                {(() => {
                                    const badge = getReviewStatusBadge(template.reviewStatus);
                                    return (
                                        <div className="flex items-center gap-2">
                                            <span className={`px-3 py-1.5 rounded-full text-xs font-medium ${badge.color} flex items-center gap-2`}>
                                                <i className={`fa-solid ${badge.icon}`}></i>
                                                {badge.text}
                                            </span>
                                        </div>
                                    );
                                })()}
                                {template.reviewStatus === 'rejected' && template.rejectionReason && (
                                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                                        <strong>Rejection Reason:</strong> {template.rejectionReason}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Message */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-medium text-gray-700">
                                Message <span className="text-red-500">*</span>
                            </label>
                            <span className={`text-xs font-medium ${charCount > (formData.isMarketing ? marketingCharLimit : charLimit)
                                ? 'text-red-600'
                                : 'text-gray-500'
                                }`}>
                                {charCount} / {formData.isMarketing ? marketingCharLimit : charLimit}
                            </span>
                        </div>
                        <textarea
                            name="message"
                            value={formData.message}
                            onChange={handleChange}
                            placeholder="Enter your WhatsApp message template..."
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none resize-none h-32 font-mono text-sm"
                            required
                        ></textarea>
                        <p className="text-xs text-gray-500 mt-1">
                            Use variables: {`{{name}}, {{phone}}, {{email}}`}
                        </p>
                    </div>

                    {/* Active Status */}
                    <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg">
                        <input
                            type="checkbox"
                            id="isActive"
                            name="isActive"
                            checked={formData.isActive}
                            onChange={handleChange}
                            className="w-4 h-4 text-green-600 rounded focus:ring-2 focus:ring-green-500"
                        />
                        <label htmlFor="isActive" className="text-sm font-medium text-gray-700 cursor-pointer">
                            Active (Template can be used)
                        </label>
                    </div>

                    {/* Automation Settings */}
                    <div className="border border-blue-200 bg-blue-50 p-4 rounded-lg space-y-4">
                        <div className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                id="isAutomated"
                                name="isAutomated"
                                checked={formData.isAutomated}
                                onChange={handleChange}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                            />
                            <label htmlFor="isAutomated" className="text-sm font-bold text-gray-800 cursor-pointer flex items-center gap-2">
                                <i className="fa-solid fa-robot text-blue-600"></i>
                                Enable Automation
                            </label>
                        </div>

                        {formData.isAutomated && (
                            <div className="space-y-3 pl-7">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-2">
                                        Trigger Type
                                    </label>
                                    <select
                                        name="triggerType"
                                        value={formData.triggerType}
                                        onChange={handleChange}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="manual">Manual Only</option>
                                        <option value="on_lead_create">On Lead Create</option>
                                        <option value="on_stage_change">On Stage Change</option>
                                    </select>
                                </div>

                                {formData.triggerType === 'on_stage_change' && (
                                    <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-2">
                                            Select Stage
                                        </label>
                                        <select
                                            name="stage"
                                            value={formData.stage}
                                            onChange={handleChange}
                                            className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Select a stage...</option>
                                            {stages.map(stage => (
                                                <option key={stage._id} value={stage.name}>
                                                    {stage.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>

                        {/* Submit for Review Button (only for marketing templates) */}
                        {template && formData.isMarketing && (
                            <button
                                type="button"
                                onClick={handleSubmitForReview}
                                disabled={submittingReview || template.reviewStatus === 'pending_review' || template.reviewStatus === 'approved'}
                                className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {submittingReview ? (
                                    <>
                                        <i className="fa-solid fa-spinner fa-spin"></i>
                                        Submitting...
                                    </>
                                ) : (
                                    <>
                                        <i className="fa-solid fa-paper-plane"></i>
                                        Submit for Review
                                    </>
                                )}
                            </button>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-save"></i>
                                    {template ? 'Update Template' : 'Create Template'}
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default WhatsAppTemplateModal;
