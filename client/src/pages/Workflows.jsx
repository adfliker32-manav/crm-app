/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';
import CommunityLibraryModal from '../components/Workflows/CommunityLibraryModal';

const TRIGGER_META = {
    LEAD_CREATED:        { label: 'Lead Created',        icon: 'fa-user-plus',     color: '#3B82F6', bg: '#EFF6FF' },
    STAGE_CHANGED:       { label: 'Stage Changed',       icon: 'fa-right-left',    color: '#8B5CF6', bg: '#F5F3FF' },
    WHATSAPP_REPLY:      { label: 'WhatsApp Reply',      icon: 'fa-brands fa-whatsapp', color: '#22C55E', bg: '#F0FDF4' },
    VOICE_CALL_FINISHED: { label: 'Voice Call Done',     icon: 'fa-phone-volume',  color: '#6366F1', bg: '#EEF2FF' },
    APPOINTMENT_BOOKED:  { label: 'Appointment Booked',  icon: 'fa-calendar-check',color: '#EC4899', bg: '#FDF2F8' },
    WEBHOOK_RECEIVED:    { label: 'Webhook',             icon: 'fa-globe',         color: '#64748B', bg: '#F8FAFC' },
    MANUAL_TRIGGER:      { label: 'Manual',              icon: 'fa-play',          color: '#F97316', bg: '#FFF7ED' },
    SCHEDULED_TRIGGER:   { label: 'Scheduled',           icon: 'fa-clock',         color: '#F59E0B', bg: '#FFFBEB' },
};

const STATUS_META = {
    draft:     { label: 'Draft',     color: '#F59E0B', bg: '#FFFBEB' },
    published: { label: 'Published', color: '#22C55E', bg: '#F0FDF4' },
    disabled:  { label: 'Disabled',  color: '#EF4444', bg: '#FEF2F2' },
    archived:  { label: 'Archived',  color: '#94A3B8', bg: '#F8FAFC' }
};

export default function Workflows() {
    const navigate = useNavigate();
    const { showNotification } = useNotification();
    const { showDanger, showInfo } = useConfirm();

    const [workflows, setWorkflows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [analytics, setAnalytics] = useState(null);
    const [filterStatus, setFilterStatus] = useState('');
    const [filterTrigger, setFilterTrigger] = useState('');
    const [libraryOpen, setLibraryOpen] = useState(false);

    const fetchWorkflows = async () => {
        try {
            setLoading(true);
            const params = {};
            if (filterStatus)  params.status  = filterStatus;
            if (filterTrigger) params.trigger  = filterTrigger;
            const [wfRes, analyticsRes] = await Promise.all([
                api.get('/workflows', { params }),
                api.get('/workflows/analytics')
            ]);
            setWorkflows(wfRes.data.workflows || []);
            setAnalytics(analyticsRes.data);
        } catch (err) {
            showNotification('error', 'Failed to load workflows');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchWorkflows(); }, [filterStatus, filterTrigger]);

    const handleDelete = async (id, name) => {
        const ok = await showDanger(`Delete "${name}"? This cannot be undone.`, 'Delete Workflow');
        if (!ok) return;
        try {
            await api.delete(`/workflows/${id}`);
            setWorkflows(ws => ws.filter(w => w._id !== id));
            showNotification('success', 'Workflow deleted');
        } catch { showNotification('error', 'Delete failed'); }
    };

    const handleDuplicate = async (id) => {
        try {
            const res = await api.post(`/workflows/${id}/duplicate`);
            setWorkflows(ws => [res.data.workflow, ...ws]);
            showNotification('success', 'Workflow duplicated as draft');
        } catch { showNotification('error', 'Duplicate failed'); }
    };

    const handleToggleStatus = async (id, currentStatus) => {
        const newStatus = currentStatus === 'published' ? 'disabled' : 'published';
        try {
            await api.patch(`/workflows/${id}/status`, { status: newStatus });
            setWorkflows(ws => ws.map(w => w._id === id ? { ...w, status: newStatus } : w));
            showNotification('success', `Workflow ${newStatus === 'published' ? 'enabled' : 'disabled'}`);
        } catch { showNotification('error', 'Status update failed'); }
    };

    const handlePublishToLibrary = async (id, name) => {
        const ok = await showInfo(
            `Share "${name}" to the Community Library? Other businesses will be able to see and clone it. Your account name will be shown as the author.`,
            'Share to Community'
        );
        if (!ok) return;
        try {
            await api.post(`/workflows/${id}/publish-to-library`);
            showNotification('success', 'Shared to the Community Library');
        } catch (err) {
            showNotification('error', err.response?.data?.message || 'Failed to share workflow');
        }
    };

    const card = (label, value, icon, color) => (
        <div style={{ background: '#fff', borderRadius: 14, padding: '16px 20px', border: '1.5px solid #E2E8F0', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <i className={`fa-solid ${icon}`} style={{ color, fontSize: 14 }} />
                </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#1E293B', marginTop: 8 }}>{value ?? '—'}</div>
        </div>
    );

    return (
        <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto', fontFamily: "'Inter', sans-serif" }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#1E293B', margin: 0 }}>
                        <i className="fa-solid fa-bolt" style={{ color: '#6366F1', marginRight: 10 }} />
                        Workflows
                    </h1>
                    <p style={{ color: '#64748B', margin: '4px 0 0', fontSize: 14 }}>Build n8n-style automations with a visual canvas editor</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={() => setLibraryOpen(true)}
                        style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #E2E8F0', background: '#fff', color: '#1E293B', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <i className="fa-solid fa-users" style={{ color: '#8B5CF6' }} /> Community Library
                    </button>
                    <button
                        onClick={() => navigate('/workflows/new/builder')}
                        style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #6366F1, #8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 14px rgba(99,102,241,0.35)' }}>
                        <i className="fa-solid fa-plus" /> New Workflow
                    </button>
                </div>
            </div>

            {/* Analytics cards */}
            {analytics && (
                <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
                    {card('Active Workflows',    analytics.activeWorkflows,    'fa-bolt',        '#6366F1')}
                    {card('Total Executions',    analytics.totalExecutions,    'fa-play-circle',  '#3B82F6')}
                    {card('Completed',           analytics.completedExecutions,'fa-check-circle', '#22C55E')}
                    {card('Success Rate',        `${analytics.successRate}%`,  'fa-chart-line',   '#10B981')}
                </div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, color: '#1E293B', background: '#fff', cursor: 'pointer', outline: 'none' }}>
                    <option value="">All Statuses</option>
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="disabled">Disabled</option>
                    <option value="archived">Archived</option>
                </select>
                <select value={filterTrigger} onChange={e => setFilterTrigger(e.target.value)}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, color: '#1E293B', background: '#fff', cursor: 'pointer', outline: 'none' }}>
                    <option value="">All Triggers</option>
                    {Object.entries(TRIGGER_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
            </div>

            {/* Workflow grid */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '80px 0', color: '#94A3B8' }}>
                    <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 28, marginBottom: 12 }} />
                    <p>Loading workflows...</p>
                </div>
            ) : workflows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '80px 0', background: '#fff', borderRadius: 16, border: '1.5px dashed #CBD5E1' }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>🔧</div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1E293B', margin: '0 0 8px' }}>No workflows yet</h3>
                    <p style={{ color: '#64748B', margin: '0 0 24px' }}>Create your first automated workflow using the visual canvas builder</p>
                    <button onClick={() => navigate('/workflows/new/builder')}
                        style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                        Create Workflow
                    </button>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                    {workflows.map(wf => {
                        const trig = TRIGGER_META[wf.trigger] || { label: wf.trigger, icon: 'fa-bolt', color: '#64748B', bg: '#F8FAFC' };
                        const status = STATUS_META[wf.status] || STATUS_META.draft;
                        return (
                            <div key={wf._id} style={{ background: '#fff', borderRadius: 14, border: '1.5px solid #E2E8F0', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, transition: 'box-shadow 0.2s, border-color 0.2s' }}
                                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = '#C7D2FE'; }}
                                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#E2E8F0'; }}>

                                {/* Top row */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 9, background: trig.bg, border: `1.5px solid ${trig.color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                            <i className={`fa-solid ${trig.icon}`} style={{ color: trig.color, fontSize: 15 }} />
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{wf.name}</div>
                                            <div style={{ fontSize: 11, color: '#94A3B8' }}>{trig.label}</div>
                                        </div>
                                    </div>
                                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: status.bg, color: status.color, flexShrink: 0, marginLeft: 8 }}>
                                        {status.label}
                                    </span>
                                </div>

                                {/* Stats row */}
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <div style={{ flex: 1, background: '#F8FAFC', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1E293B' }}>{wf.executionCount || 0}</div>
                                        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>Executions</div>
                                    </div>
                                    <div style={{ flex: 1, background: '#F8FAFC', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 18, fontWeight: 800, color: '#1E293B' }}>{(wf.nodes || wf.nodeCount || 0)}</div>
                                        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>Nodes</div>
                                    </div>
                                    <div style={{ flex: 1, background: '#F8FAFC', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>{wf.version || 1}</div>
                                        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>Version</div>
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: 6 }}>
                                    <button onClick={() => navigate(`/workflows/${wf._id}/builder`)}
                                        style={{ flex: 2, padding: '8px 0', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#1E293B', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                        <i className="fa-solid fa-pencil" /> Edit
                                    </button>
                                    {(wf.status === 'published' || wf.status === 'disabled') && (
                                        <button onClick={() => handleToggleStatus(wf._id, wf.status)}
                                            style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${wf.status === 'published' ? '#EF444433' : '#22C55E33'}`, background: wf.status === 'published' ? '#FEF2F2' : '#F0FDF4', color: wf.status === 'published' ? '#EF4444' : '#22C55E', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                            {wf.status === 'published' ? 'Pause' : 'Enable'}
                                        </button>
                                    )}
                                    <button onClick={() => handlePublishToLibrary(wf._id, wf.name)} title="Share to Community"
                                        style={{ width: 34, borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#8B5CF6', fontSize: 12, cursor: 'pointer' }}>
                                        <i className="fa-solid fa-share-nodes" />
                                    </button>
                                    <button onClick={() => handleDuplicate(wf._id)} title="Duplicate"
                                        style={{ width: 34, borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: 12, cursor: 'pointer' }}>
                                        <i className="fa-solid fa-copy" />
                                    </button>
                                    <button onClick={() => handleDelete(wf._id, wf.name)} title="Delete"
                                        style={{ width: 34, borderRadius: 8, border: '1.5px solid #FEE2E2', background: '#FEF2F2', color: '#EF4444', fontSize: 12, cursor: 'pointer' }}>
                                        <i className="fa-solid fa-trash" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <CommunityLibraryModal
                isOpen={libraryOpen}
                onClose={() => setLibraryOpen(false)}
                triggerMeta={TRIGGER_META}
            />
        </div>
    );
}
