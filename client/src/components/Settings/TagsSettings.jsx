/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const TagsSettings = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [newTagName, setNewTagName] = useState('');
    const [newTagColor, setNewTagColor] = useState('#3b82f6'); // Default Blue

    const presetColors = [
        '#ef4444', // Red
        '#f97316', // Orange
        '#eab308', // Yellow
        '#22c55e', // Green
        '#3b82f6', // Blue
        '#8b5cf6', // Purple
        '#db2777', // Pink
        '#64748b'  // Slate/Gray
    ];

    const fetchTags = async () => {
        try {
            const res = await api.get('/tags');
            setTags(res.data);
        } catch (err) {
            showError('Failed to load tags');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTags();
    }, []);

    const handleCreateTag = async (e) => {
        e.preventDefault();
        if (!newTagName.trim()) return;

        try {
            const res = await api.post('/tags', { name: newTagName, color: newTagColor });
            setTags([...tags, res.data]);
            setNewTagName('');
            setNewTagColor('#3b82f6');
            showSuccess('Tag created successfully');
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to create tag');
        }
    };

    const handleDelete = async (id) => {
        const confirmed = await showDanger('Are you sure you want to delete this tag? Existing leads with this tag will retain the text but lose color formatting.', 'Delete Tag');
        if (!confirmed) return;
        
        try {
            await api.delete(`/tags/${id}`);
            setTags(tags.filter(t => t._id !== id));
            showSuccess('Tag deleted');
        } catch (err) {
            showError('Failed to delete tag');
        }
    };

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
                <h2 className="text-xl font-bold text-slate-800">Lead Tags</h2>
                <p className="text-sm text-slate-500 mt-1">Create and manage color-coded tags to categorize your leads.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Create Tag Form */}
                <div className="md:col-span-1">
                    <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                        <h3 className="text-sm font-bold text-slate-700 mb-4 uppercase tracking-wider">Create New Tag</h3>
                        <form onSubmit={handleCreateTag} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Tag Name</label>
                                <input
                                    type="text"
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    placeholder="e.g. VIP, Hot Lead"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    required
                                    maxLength={25}
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Color</label>
                                <div className="flex flex-wrap gap-2">
                                    {presetColors.map(color => (
                                        <button
                                            key={color}
                                            type="button"
                                            onClick={() => setNewTagColor(color)}
                                            className={`w-6 h-6 rounded-full border-2 transition-transform ${newTagColor === color ? 'border-blue-600 scale-125 shadow-sm' : 'border-transparent'}`}
                                            style={{ backgroundColor: color }}
                                            title={color}
                                        />
                                    ))}
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={!newTagName.trim()}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg text-sm transition disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                            >
                                <i className="fa-solid fa-plus mr-2"></i> Add Tag
                            </button>
                        </form>
                    </div>
                </div>

                {/* Tag List */}
                <div className="md:col-span-2 space-y-4">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Existing Tags ({tags.length})</h3>
                    
                    {tags.length === 0 ? (
                        <div className="text-center py-8 bg-slate-50 border border-dashed border-slate-300 rounded-xl">
                            <i className="fa-solid fa-tags text-slate-400 text-3xl mb-3"></i>
                            <p className="text-slate-500 text-sm">No tags created yet. Create your first tag to start organizing leads.</p>
                        </div>
                    ) : (
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                            {tags.map(tag => (
                                <div key={tag._id} className="flex items-center justify-between p-4 hover:bg-slate-50 transition">
                                    <div className="flex items-center gap-3">
                                        <span 
                                            className="inline-block w-3 h-3 rounded-full" 
                                            style={{ backgroundColor: tag.color }}
                                        ></span>
                                        <span className="font-semibold text-slate-700">{tag.name}</span>
                                    </div>
                                    <button 
                                        onClick={() => handleDelete(tag._id)}
                                        className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm transition"
                                        title="Delete Tag"
                                    >
                                        <i className="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TagsSettings;
