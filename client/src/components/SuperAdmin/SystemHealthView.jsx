import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const SystemHealthView = () => {
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);

    const fetchHealth = async () => {
        try {
            const res = await api.get('/superadmin/system-health');
            setHealth(res.data.health);
            setLastUpdated(new Date());
            setError(null);
        } catch (err) {
            console.error('Failed to fetch system health:', err);
            setError('Failed to connect to the telemetry service.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHealth();
        const intervalId = setInterval(fetchHealth, 15000); // 15s refresh
        return () => clearInterval(intervalId);
    }, []);

    if (loading && !health) {
        return (
            <div className="flex items-center justify-center h-96">
                <i className="fa-solid fa-satellite-dish fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    if (error && !health) {
        return (
            <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-xl shadow-lg">
                <div className="flex items-center gap-3 mb-2">
                    <i className="fa-solid fa-skull-crossbones text-3xl"></i>
                    <h2 className="text-xl font-black uppercase tracking-wider">Telemetry Link Offline</h2>
                </div>
                <p className="font-mono">{error}</p>
                <button onClick={fetchHealth} className="mt-4 bg-red-600 font-bold text-white px-6 py-2 rounded shadow hover:bg-red-700">
                    Force Reconnection
                </button>
            </div>
        );
    }

    const { alertStatus, api: apiStats, webhook, queue, database, delivery, server, topTenant } = health;
    const isRedAlert = alertStatus.level === 'critical' || alertStatus.level === 'outage';
    const isWarning = alertStatus.level === 'warning';

    // Theme Config based on Level
    const theme = {
        'healthy': { bg: 'bg-emerald-500', text: 'text-emerald-500', icon: 'fa-check-circle', label: 'ALL SYSTEMS NOMINAL' },
        'warning': { bg: 'bg-amber-500', text: 'text-amber-500', icon: 'fa-triangle-exclamation', label: 'WARNING DETECTED' },
        'critical': { bg: 'bg-red-600', text: 'text-red-600', icon: 'fa-radiation', label: 'CRITICAL ALERT' },
        'outage': { bg: 'bg-black', text: 'text-black', icon: 'fa-skull', label: 'SEVERE OUTAGE' }
    }[alertStatus.level] || theme['healthy'];

    return (
        <div className="space-y-6 animate-fade-in-up pb-12">
            {/* Incident Command Header */}
            <div className={`${theme.bg} text-white p-6 rounded-2xl shadow-xl transition-colors duration-500 flex flex-col md:flex-row justify-between items-start md:items-center relative overflow-hidden`}>
                <div className="z-10 relative">
                    <div className="flex items-center gap-3 mb-1">
                        <i className={`fa-solid ${theme.icon} text-3xl animate-pulse`}></i>
                        <h1 className="text-3xl font-black uppercase tracking-widest">{theme.label}</h1>
                    </div>
                    <p className="text-white/80 font-mono text-sm mt-2">
                        System Defense Protocol Online • Telemetry Pulse: {lastUpdated?.toLocaleTimeString()}
                    </p>
                </div>

                <div className="z-10 mt-4 md:mt-0 flex flex-col items-end gap-2">
                    <button onClick={fetchHealth} className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded font-bold transition flex items-center gap-2 backdrop-blur-sm shadow">
                        <i className="fa-solid fa-rotate text-sm"></i> Sync Telemetry
                    </button>
                </div>
                
                {/* Decorative alert rings */}
                {isRedAlert && (
                    <div className="absolute top-1/2 left-12 -translate-y-1/2 w-32 h-32 rounded-full border-4 border-white/20 animate-ping"></div>
                )}
            </div>

            {/* Active Triggers Readout */}
            {alertStatus.triggers.length > 0 && (
                <div className={`p-4 rounded-xl border-l-4 font-mono text-sm shadow-sm ${isRedAlert ? 'bg-red-50 border-red-500 text-red-700' : 'bg-amber-50 border-amber-500 text-amber-800'}`}>
                    <div className="font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-list-ul"></i> Active Incident Signatures:
                    </div>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                        {alertStatus.triggers.map((trigger, i) => (
                            <li key={i}>{trigger}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="mb-2 mt-8">
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest">8 Pillars of Survival</h2>
            </div>
            
            {/* Metric Grid : The 8 Pillars */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

                {/* 1. API Failure Rate */}
                <div className={`p-5 rounded-xl border shadow-sm ${apiStats.errorRatePercent > 3 ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>1. API Integrity</span>
                        <i className="fa-solid fa-network-wired"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${apiStats.errorRatePercent > 3 ? 'text-red-600' : 'text-slate-800'}`}>
                            {apiStats.errorRatePercent}%
                        </span>
                        <span className="text-xs font-bold text-slate-500">5xx ERRORS</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className={apiStats.authFailurePercent > 20 ? 'text-red-500 font-bold' : 'text-slate-500'}>
                            Auth Spike: {apiStats.authFailurePercent}%
                        </span>
                        <span className="text-slate-500">Load: {apiStats.totalRequests}/15m</span>
                    </div>
                </div>

                {/* 2. Webhook Health */}
                <div className={`p-5 rounded-xl border shadow-sm ${webhook.successRatePercent < 95 ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>2. Meta Webhooks</span>
                        <i className="fa-solid fa-plug-circle-check"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${webhook.successRatePercent < 95 ? 'text-red-600' : 'text-emerald-500'}`}>
                            {webhook.successRatePercent}%
                        </span>
                        <span className="text-xs font-bold text-slate-500">SUCCESS</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className={webhook.avgLatencyMs > 10000 ? 'text-red-500 font-bold' : 'text-slate-500'}>
                            Lag: {webhook.avgLatencyMs}ms
                        </span>
                        <span className="text-slate-500">Retries: {webhook.totalRetries}</span>
                    </div>
                </div>

                {/* 3. Automation Engine */}
                <div className={`p-5 rounded-xl border shadow-sm ${queue.agenda.automationFailures > 5 ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>3. Workflow Engine</span>
                        <i className="fa-solid fa-gears"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${queue.agenda.automationFailures > 5 ? 'text-red-600' : 'text-slate-800'}`}>
                            {queue.agenda.automationFailures}
                        </span>
                        <span className="text-xs font-bold text-slate-500">FAULTS</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className={queue.agenda.failed > 0 ? 'text-rose-500 font-bold' : 'text-slate-500'}>
                            Sys Fails: {queue.agenda.failed}
                        </span>
                        <span className="text-slate-500">Total: {queue.agenda.total}</span>
                    </div>
                </div>

                {/* 4. Queue Backlog */}
                <div className={`p-5 rounded-xl border shadow-sm ${(queue.agenda.pending > 100 && queue.agenda.active === 0) ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>4. Queue Backlog</span>
                        <i className="fa-solid fa-layer-group"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${queue.agenda.pending > 100 ? 'text-amber-500' : 'text-slate-800'}`}>
                            {queue.agenda.pending}
                        </span>
                        <span className="text-xs font-bold text-slate-500">PENDING</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className="text-slate-500">Active Workers: {queue.agenda.active}</span>
                    </div>
                </div>

                {/* 5. DB Saturation */}
                <div className={`p-5 rounded-xl border shadow-sm ${database.connections > 400 ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>5. DB Saturation</span>
                        <i className="fa-solid fa-database"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${database.connections > 400 ? 'text-red-600' : 'text-slate-800'}`}>
                            {database.connections}
                        </span>
                        <span className="text-xs font-bold text-slate-500">CONNS</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className="text-slate-500">Active Locks: {database.activeQueries || 0}</span>
                    </div>
                </div>

                {/* 6. Messaging Delivery */}
                <div className={`p-5 rounded-xl border shadow-sm ${(delivery.whatsapp.successRate < 93 && delivery.whatsapp.totalAttempts > 10) ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>6. Msg Delivery (24H)</span>
                        <i className="fa-brands fa-whatsapp"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${(delivery.whatsapp.successRate < 93 && delivery.whatsapp.totalAttempts > 10) ? 'text-red-600' : 'text-slate-800'}`}>
                            {delivery.whatsapp.successRate}%
                        </span>
                        <span className="text-xs font-bold text-slate-500">DELIVERED</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className="text-slate-500">Sends: {delivery.whatsapp.sent24h}</span>
                        <span className={delivery.whatsapp.failed24h > 5 ? 'text-red-500 font-bold' : 'text-slate-500'}>
                            Fails: {delivery.whatsapp.failed24h}
                        </span>
                    </div>
                </div>

                {/* 7. Infra Crashes */}
                <div className={`p-5 rounded-xl border shadow-sm ${(server.memoryUsageMB / server.totalMemoryMB) > 0.9 ? 'border-red-500 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>7. Infra Stability</span>
                        <i className="fa-solid fa-server"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${(server.memoryUsageMB / server.totalMemoryMB) > 0.9 ? 'text-red-600' : 'text-slate-800'}`}>
                            {Math.round((server.memoryUsageMB / server.totalMemoryMB) * 100)}%
                        </span>
                        <span className="text-xs font-bold text-slate-500">RAM USED</span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs font-mono">
                        <span className="text-slate-500 group relative">
                            CPU [1m]: {server.loadAverage[0].toFixed(2)}
                        </span>
                        <span className="text-slate-500">
                            Up: {Math.floor(server.uptimeSeconds / 3600)}h
                        </span>
                    </div>
                </div>

                {/* 8. Tenant Abuse */}
                <div className={`p-5 rounded-xl border shadow-sm ${(topTenant && topTenant.requestCount > 5000) ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase flex justify-between">
                        <span>8. Abuse Radar</span>
                        <i className="fa-solid fa-shield-halved"></i>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-black ${(topTenant && topTenant.requestCount > 5000) ? 'text-amber-500' : 'text-slate-800'}`}>
                            {topTenant ? topTenant.requestCount : 0}
                        </span>
                        <span className="text-xs font-bold text-slate-500">MAX REQ/TENANT</span>
                    </div>
                    <div className="mt-3 truncate text-xs font-mono">
                        <span className="text-slate-500 truncate">
                            Target: {topTenant ? topTenant.tenantId : 'None'}
                        </span>
                    </div>
                </div>

            </div>
        </div>
    );
};

export default SystemHealthView;
