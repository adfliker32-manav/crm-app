import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const CommunityLibraryModal = ({ isOpen, onClose, triggerMeta }) => {
    const navigate = useNavigate();
    const { showNotification } = useNotification();

    const [items, setItems]       = useState([]);
    const [loading, setLoading]   = useState(true);
    const [sort, setSort]         = useState('popular');
    const [cloningId, setCloningId] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                const res = await api.get('/workflow-library', { params: { sort } });
                if (!cancelled) setItems(res.data.items || []);
            } catch {
                if (!cancelled) showNotification('error', 'Failed to load the community library');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, sort]);

    const handleClone = async (item) => {
        setCloningId(item._id);
        try {
            const res = await api.post(`/workflow-library/${item._id}/clone`);
            showNotification('success', `Cloned "${item.name}" — opening in the builder`);
            onClose();
            navigate(`/workflows/${res.data.workflow._id}/builder`);
            // No finally-reset here: onClose()/navigate() unmount this modal on
            // success, so setting state afterward would target an unmounted component.
        } catch (err) {
            showNotification('error', err.response?.data?.message || 'Failed to clone workflow');
            setCloningId(null);
        }
    };

    if (!isOpen) return null;

    const pill = (key, label) => (
        <button onClick={() => setSort(key)}
            style={{
                padding: '6px 16px', borderRadius: 20, border: `1.5px solid ${sort === key ? '#6366F1' : '#E2E8F0'}`,
                background: sort === key ? '#EEF2FF' : '#fff', color: sort === key ? '#6366F1' : '#64748B',
                fontSize: 13, fontWeight: 700, cursor: 'pointer'
            }}>
            {label}
        </button>
    );

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, fontFamily: "'Inter', sans-serif" }}>
            <div style={{ background: '#fff', borderRadius: 18, width: '100%', maxWidth: 920, maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '22px 26px 16px', borderBottom: '1.5px solid #F1F5F9' }}>
                    <div>
                        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1E293B', margin: 0 }}>
                            <i className="fa-solid fa-users" style={{ color: '#8B5CF6', marginRight: 8 }} />
                            Community Library
                        </h2>
                        <p style={{ color: '#64748B', margin: '4px 0 0', fontSize: 13 }}>Workflows shared by other businesses — clone one into your workspace as a draft</p>
                    </div>
                    <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#94A3B8', fontSize: 18, cursor: 'pointer', padding: 4 }}>
                        <i className="fa-solid fa-xmark" />
                    </button>
                </div>

                {/* Sort toggle */}
                <div style={{ display: 'flex', gap: 8, padding: '16px 26px 0' }}>
                    {pill('popular', 'Popular')}
                    {pill('newest', 'Newest')}
                </div>

                {/* Body */}
                <div style={{ padding: '16px 26px 26px', overflowY: 'auto', flex: 1 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
                            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 24, marginBottom: 10 }} />
                            <p>Loading community templates...</p>
                        </div>
                    ) : items.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 0', background: '#F8FAFC', borderRadius: 14, border: '1.5px dashed #CBD5E1' }}>
                            <div style={{ fontSize: 40, marginBottom: 12 }}>🌟</div>
                            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1E293B', margin: '0 0 6px' }}>No community templates yet</h3>
                            <p style={{ color: '#64748B', margin: 0, fontSize: 13 }}>Be the first to share a workflow from the "Share to Community" option on any workflow card.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                            {items.map(item => {
                                const trig = (triggerMeta && triggerMeta[item.trigger]) || { label: item.trigger, icon: 'fa-bolt', color: '#64748B', bg: '#F8FAFC' };
                                const cloning = cloningId === item._id;
                                return (
                                    <div key={item._id} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ width: 32, height: 32, borderRadius: 8, background: trig.bg, border: `1.5px solid ${trig.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                                <i className={`fa-solid ${trig.icon}`} style={{ color: trig.color, fontSize: 13 }} />
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.name}</div>
                                                <div style={{ fontSize: 11, color: '#94A3B8' }}>{trig.label}</div>
                                            </div>
                                        </div>

                                        {item.description && (
                                            <p style={{ fontSize: 12, color: '#64748B', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                {item.description}
                                            </p>
                                        )}

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#94A3B8' }}>
                                            <span>by {item.authorName}</span>
                                            <span><i className="fa-solid fa-copy" style={{ marginRight: 4 }} />{item.cloneCount || 0} clones</span>
                                        </div>

                                        <button onClick={() => handleClone(item)} disabled={cloning}
                                            style={{ marginTop: 4, padding: '8px 0', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: cloning ? 'default' : 'pointer', opacity: cloning ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                            <i className={`fa-solid ${cloning ? 'fa-spinner fa-spin' : 'fa-clone'}`} />
                                            {cloning ? 'Cloning...' : 'Clone to My Workspace'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CommunityLibraryModal;
