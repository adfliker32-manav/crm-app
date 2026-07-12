/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPER COMPONENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

const formatUptime = (seconds) => {
    if (!seconds) return '0s';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

const StatusDot = ({ ok, size = 'w-2.5 h-2.5' }) => (
    <span className={`${size} rounded-full inline-block ${ok ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'}`} />
);

const MetricCard = ({ label, value, suffix, icon, status, sub, className = '' }) => (
    <div className={`bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-xl p-5 hover:border-slate-600/70 transition-all duration-300 ${className}`}>
        <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
            {icon && <i className={`fa-solid ${icon} text-slate-500 text-sm`} />}
        </div>
        <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-black ${
                status === 'critical' ? 'text-red-400' :
                status === 'warning' ? 'text-amber-400' :
                status === 'good' ? 'text-emerald-400' : 'text-white'
            }`}>{value}</span>
            {suffix && <span className="text-xs font-bold text-slate-500">{suffix}</span>}
        </div>
        {sub && <div className="mt-2 text-xs text-slate-500 font-mono">{sub}</div>}
    </div>
);

const TabLoader = () => (
    <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
            <i className="fa-solid fa-satellite-dish fa-spin text-3xl text-slate-500" />
            <span className="text-sm text-slate-500 font-mono">Loading telemetry...</span>
        </div>
    </div>
);

const TabError = ({ msg, onRetry }) => (
    <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-6 rounded-xl">
        <div className="flex items-center gap-3 mb-2">
            <i className="fa-solid fa-circle-exclamation text-xl" />
            <span className="font-bold">Failed to load</span>
        </div>
        <p className="text-sm font-mono text-red-400/80 mb-3">{msg}</p>
        {onRetry && (
            <button onClick={onRetry} className="bg-red-500/20 hover:bg-red-500/30 px-4 py-2 rounded-lg font-semibold text-sm transition">
                <i className="fa-solid fa-rotate mr-2" />Retry
            </button>
        )}
    </div>
);

const DataTable = ({ headers, rows, emptyMsg = 'No data' }) => (
    <div className="overflow-x-auto rounded-xl border border-slate-700/50">
        <table className="w-full text-sm">
            <thead>
                <tr className="bg-slate-800/80">
                    {headers.map((h, i) => (
                        <th key={i} className="text-left text-[11px] text-slate-400 uppercase tracking-wider font-semibold px-4 py-3 border-b border-slate-700/50">{h}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.length === 0 ? (
                    <tr><td colSpan={headers.length} className="text-center text-slate-500 py-8 font-mono">{emptyMsg}</td></tr>
                ) : rows.map((row, i) => (
                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-colors">
                        {row.map((cell, j) => (
                            <td key={j} className="px-4 py-3 text-slate-300 font-mono text-xs">{cell}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CUSTOM HOOK: fetch tab data
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const useTabData = (endpoint, activeTab, tabKey, refreshInterval = 0) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetch = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.get(endpoint);
            setData(res.data.data || res.data.health || res.data);
            setError(null);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Connection failed');
        } finally {
            setLoading(false);
        }
    }, [endpoint]);

    useEffect(() => {
        if (activeTab !== tabKey) return;
        fetch();
        if (refreshInterval > 0) {
            const id = setInterval(fetch, refreshInterval);
            return () => clearInterval(id);
        }
    }, [activeTab, tabKey, fetch, refreshInterval]);

    return { data, loading, error, refetch: fetch };
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 1: OVERVIEW
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const OverviewTab = ({ activeTab }) => {
    const { data: h, loading, error, refetch } = useTabData('/superadmin/system-health', activeTab, 'overview', 30000);

    if (loading && !h) return <TabLoader />;
    if (error && !h) return <TabError msg={error} onRetry={refetch} />;
    if (!h) return null;

    const alert = h.alertStatus || { level: 'healthy', triggers: [] };
    const THEMES = {
        healthy:  { bg: 'from-emerald-600 to-emerald-700', icon: 'fa-check-circle',         label: 'ALL SYSTEMS NOMINAL' },
        warning:  { bg: 'from-amber-600 to-amber-700',     icon: 'fa-triangle-exclamation', label: 'WARNING DETECTED' },
        critical: { bg: 'from-red-600 to-red-700',         icon: 'fa-radiation',            label: 'CRITICAL ALERT' },
        outage:   { bg: 'from-red-900 to-black',           icon: 'fa-skull',                label: 'SEVERE OUTAGE' }
    };
    const theme = THEMES[alert.level] || THEMES.healthy;

    const cpuPercent = h.cpu?.percentOfMachine || 0;
    // Use RSS (true process footprint) for the RAM %, not heapUsed which only
    // reflects the V8 heap and understates real memory pressure.
    const rssMB = h.server?.rssMB || h.server?.memoryUsageMB || 0;
    const ramPercent = h.server?.totalMemoryMB > 0 ? Math.round((rssMB / h.server.totalMemoryMB) * 100) : 0;

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Status Banner */}
            <div className={`bg-gradient-to-r ${theme.bg} p-6 rounded-2xl shadow-2xl relative overflow-hidden`}>
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <i className={`fa-solid ${theme.icon} text-2xl text-white/90 animate-pulse`} />
                            <h1 className="text-2xl font-black text-white uppercase tracking-widest">{theme.label}</h1>
                        </div>
                        <p className="text-white/60 font-mono text-xs mt-1">
                            System Monitor • Auto-refresh 30s • {new Date().toLocaleTimeString()}
                        </p>
                    </div>
                    <button onClick={refetch} className="mt-3 md:mt-0 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg font-bold text-sm transition flex items-center gap-2">
                        <i className="fa-solid fa-rotate text-xs" /> Sync
                    </button>
                </div>
                {alert.level !== 'healthy' && (
                    <div className="absolute top-1/2 right-8 -translate-y-1/2 w-24 h-24 rounded-full border-2 border-white/10 animate-ping" />
                )}
            </div>

            {/* Alert Triggers */}
            {alert.triggers?.length > 0 && (
                <div className={`p-4 rounded-xl border-l-4 text-sm space-y-1 ${
                    alert.level === 'critical' || alert.level === 'outage' ? 'bg-red-500/10 border-red-500 text-red-400' : 'bg-amber-500/10 border-amber-500 text-amber-400'
                }`}>
                    <div className="font-bold uppercase tracking-wider text-xs mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-bell" /> Active Alerts
                    </div>
                    {alert.triggers.map((t, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-xs">
                            <span>{t.emoji || '⚠️'}</span>
                            <span>{t.message || t}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Main Metric Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Overall Health" value={alert.level?.toUpperCase()} icon="fa-heart-pulse"
                    status={alert.level === 'healthy' ? 'good' : alert.level === 'warning' ? 'warning' : 'critical'} />
                <MetricCard label="CPU" value={`${cpuPercent}%`} icon="fa-microchip"
                    status={cpuPercent > 90 ? 'critical' : cpuPercent > 70 ? 'warning' : 'good'}
                    sub={`${h.cpu?.cores || '?'} cores`} />
                <MetricCard label="RAM" value={`${ramPercent}%`} icon="fa-memory"
                    status={ramPercent > 90 ? 'critical' : ramPercent > 75 ? 'warning' : 'good'}
                    sub={`RSS ${rssMB} / ${h.server?.totalMemoryMB || 0} MB · heap ${h.server?.memoryUsageMB || 0}`} />
                <MetricCard label="Mongo Status" icon="fa-database"
                    value={h.mongoStatus === 'connected' ? 'Online' : h.mongoStatus?.toUpperCase()}
                    status={h.mongoStatus === 'connected' ? 'good' : 'critical'}
                    sub={`${h.database?.connections || 0} connections`} />
                <MetricCard label="Redis Status" icon="fa-server"
                    value={h.redis?.ok ? 'Online' : h.redis?.configured ? 'Error' : 'N/A'}
                    status={h.redis?.ok ? 'good' : h.redis?.configured ? 'critical' : null}
                    sub={h.redis?.pingMs ? `${h.redis.pingMs}ms latency` : ''} />
                <MetricCard label="Active Users" value={h.activeUsers || 0} icon="fa-users" />
                <MetricCard label="Today's Requests" value={(h.todayRequests || 0).toLocaleString()} icon="fa-arrow-right-arrow-left"
                    sub={`${h.requestsPerSecond || 0} req/s`} />
                <MetricCard label="Error Rate" value={`${h.api?.errorRatePercent || 0}%`} icon="fa-bug"
                    status={(h.api?.errorRatePercent || 0) > 5 ? 'critical' : (h.api?.errorRatePercent || 0) > 2 ? 'warning' : 'good'}
                    sub={`5xx: ${h.api?.error5xxCount || 0} | 4xx: ${h.api?.error4xxCount || 0}`} />
            </div>

            {/* Quick Queue Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Queue Waiting" value={(h.queue?.broadcast?.waiting || 0) + (h.queue?.workflow?.waiting || 0)} icon="fa-hourglass-half"
                    status={(h.queue?.broadcast?.waiting || 0) + (h.queue?.workflow?.waiting || 0) > 1000 ? 'warning' : null} />
                <MetricCard label="Queue Active" value={(h.queue?.broadcast?.active || 0) + (h.queue?.workflow?.active || 0)} icon="fa-play" />
                <MetricCard label="Queue Failed" value={(h.queue?.broadcast?.failed || 0) + (h.queue?.workflow?.failed || 0)} icon="fa-circle-xmark"
                    status={(h.queue?.broadcast?.failed || 0) + (h.queue?.workflow?.failed || 0) > 0 ? 'warning' : 'good'} />
                <MetricCard label="DB Storage" value={formatBytes(h.database?.totalUsedBytes)} icon="fa-hard-drive"
                    sub={`Limit: ${formatBytes(h.database?.storageLimitBytes)}`}
                    status={h.database?.storageLimitBytes > 0 && (h.database.totalUsedBytes / h.database.storageLimitBytes) > 0.8 ? 'warning' : 'good'} />
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 2: API PERFORMANCE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ApiPerformanceTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/api', activeTab, 'api', 30000);

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">API Performance</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Avg Response" value={`${d.avgLatencyMs || 0}`} suffix="ms" icon="fa-clock"
                    status={(d.avgLatencyMs || 0) > 1000 ? 'critical' : (d.avgLatencyMs || 0) > 500 ? 'warning' : 'good'} />
                <MetricCard label="P95 Latency" value={`${d.p95Ms || 0}`} suffix="ms" icon="fa-gauge-high"
                    status={(d.p95Ms || 0) > 2000 ? 'critical' : (d.p95Ms || 0) > 1000 ? 'warning' : 'good'} />
                <MetricCard label="P99 Latency" value={`${d.p99Ms || 0}`} suffix="ms" icon="fa-gauge"
                    status={(d.p99Ms || 0) > 3000 ? 'critical' : (d.p99Ms || 0) > 1500 ? 'warning' : 'good'} />
                <MetricCard label="Requests/sec" value={d.requestsPerSecond || 0} icon="fa-bolt" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Total Requests" value={(d.totalRequests || 0).toLocaleString()} icon="fa-arrow-right-arrow-left" />
                <MetricCard label="4xx Errors" value={d.error4xxCount || 0} icon="fa-triangle-exclamation" status={(d.error4xxCount || 0) > 50 ? 'warning' : null} />
                <MetricCard label="5xx Errors" value={d.error5xxCount || 0} icon="fa-skull-crossbones" status={(d.error5xxCount || 0) > 0 ? 'critical' : 'good'} />
                <MetricCard label="Error Rate" value={`${d.errorRatePercent || 0}%`} icon="fa-chart-line"
                    status={(d.errorRatePercent || 0) > 5 ? 'critical' : (d.errorRatePercent || 0) > 2 ? 'warning' : 'good'} />
            </div>

            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-6">Slowest APIs</h3>
            <DataTable
                headers={['Route', 'Avg (ms)', 'Max (ms)', 'Calls']}
                rows={(d.slowestApis || []).map(a => [
                    a.route,
                    <span className={a.avgMs > 1000 ? 'text-red-400 font-bold' : a.avgMs > 500 ? 'text-amber-400' : 'text-emerald-400'}>{a.avgMs}</span>,
                    a.maxMs,
                    a.calls
                ])}
                emptyMsg="No API traffic recorded yet"
            />
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 3: DATABASE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DatabaseTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/database', activeTab, 'database');

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    const storagePercent = d.storageLimitBytes > 0 ? Math.round((d.totalUsedBytes / d.storageLimitBytes) * 100) : 0;

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Database Monitor</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Connections" value={d.connections || 0} icon="fa-plug" sub={`Available: ${d.availableConns || '?'}`}
                    status={(d.connections || 0) > 400 ? 'critical' : (d.connections || 0) > 200 ? 'warning' : 'good'} />
                <MetricCard label="Active Clients" value={d.activeClients || 0} icon="fa-user-clock" />
                <MetricCard label="Storage Used" value={formatBytes(d.totalUsedBytes)} icon="fa-hard-drive"
                    sub={`${storagePercent}% of ${formatBytes(d.storageLimitBytes)}`}
                    status={storagePercent > 95 ? 'critical' : storagePercent > 80 ? 'warning' : 'good'} />
                <MetricCard label="Mongo Version" value={d.mongoVersion || '?'} icon="fa-database" />
            </div>

            {/* Storage Bar */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
                <div className="flex justify-between text-xs text-slate-400 mb-2">
                    <span>Storage: {formatBytes(d.dataSize)} data + {formatBytes(d.indexSize)} indexes</span>
                    <span>{storagePercent}%</span>
                </div>
                <div className="w-full bg-slate-700/50 rounded-full h-3 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-700 ${
                        storagePercent > 95 ? 'bg-red-500' : storagePercent > 80 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`} style={{ width: `${Math.min(storagePercent, 100)}%` }} />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Collection Sizes (Top 15)</h3>
                    <DataTable
                        headers={['Collection', 'Size', 'Docs', 'Indexes']}
                        rows={(d.collectionStats || []).map(c => [
                            c.name, formatBytes(c.sizeBytes), (c.count || 0).toLocaleString(), c.indexCount || 0
                        ])}
                    />
                </div>
                <div>
                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">Slow Queries (Active)</h3>
                    <DataTable
                        headers={['Namespace', 'Op', 'Seconds', 'Command']}
                        rows={(d.slowQueries || []).map(q => [
                            q.namespace,
                            q.operation,
                            <span className="text-red-400 font-bold">{q.runningSeconds}s</span>,
                            q.command
                        ])}
                        emptyMsg="No slow queries active"
                    />

                    <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 mt-6">Index Status</h3>
                    <DataTable
                        headers={['Collection', 'Index Count', 'Index Size']}
                        rows={(d.indexStatus || []).map(idx => [
                            idx.collection, idx.indexCount, formatBytes(idx.indexSizeBytes)
                        ])}
                    />
                </div>
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 4: REDIS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const RedisTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/redis', activeTab, 'redis');

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    if (!d.configured) return (
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-8 text-center">
            <i className="fa-solid fa-server text-4xl text-slate-500 mb-4" />
            <h3 className="text-lg font-bold text-slate-400">Redis Not Configured</h3>
            <p className="text-sm text-slate-500 mt-2">Set REDIS_URL in your environment to enable Redis monitoring.</p>
        </div>
    );

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest flex items-center gap-3">
                    Redis Monitor <StatusDot ok={d.ok} />
                </h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Memory Usage" value={d.usedMemoryHuman || '0B'} icon="fa-memory"
                    sub={d.maxmemoryHuman ? `Limit: ${d.maxmemoryHuman}` : ''} />
                <MetricCard label="Connected Clients" value={d.connectedClients || 0} icon="fa-users" />
                <MetricCard label="Latency" value={`${d.pingMs || 0}`} suffix="ms" icon="fa-clock"
                    status={(d.pingMs || 0) > 50 ? 'warning' : 'good'} />
                <MetricCard label="Key Count" value={(d.keyCount || 0).toLocaleString()} icon="fa-key" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Cache Hit Rate" value={`${d.cacheHitRate || 100}%`} icon="fa-bullseye"
                    status={(d.cacheHitRate || 100) < 80 ? 'warning' : 'good'}
                    sub={`Hits: ${(d.keyspaceHits || 0).toLocaleString()} | Misses: ${(d.keyspaceMisses || 0).toLocaleString()}`} />
                <MetricCard label="Redis Version" value={d.redisVersion || '?'} icon="fa-info-circle" />
                <MetricCard label="Uptime" value={formatUptime(d.uptimeSeconds)} icon="fa-clock-rotate-left" />
                <MetricCard label="Evicted Keys" value={d.evictedKeys || 0} icon="fa-trash"
                    status={(d.evictedKeys || 0) > 0 ? 'warning' : 'good'} />
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 5: QUEUE MONITOR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const QueueMonitorTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/queues', activeTab, 'queues', 15000);

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    const c = d.bullmq?.combined || {};
    const agenda = d.agenda || {};

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Queue Monitor</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            {/* BullMQ Combined */}
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">BullMQ Queues (Combined)</h3>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
                <MetricCard label="Waiting" value={c.waiting || 0} icon="fa-hourglass-half"
                    status={(c.waiting || 0) > 1000 ? 'warning' : null} />
                <MetricCard label="Active" value={c.active || 0} icon="fa-play" status="good" />
                <MetricCard label="Completed" value={(c.completed || 0).toLocaleString()} icon="fa-check" />
                <MetricCard label="Failed" value={c.failed || 0} icon="fa-circle-xmark"
                    status={(c.failed || 0) > 0 ? 'critical' : 'good'} />
                <MetricCard label="Delayed" value={c.delayed || 0} icon="fa-clock" />
                <MetricCard label="Paused" value={c.paused || 0} icon="fa-pause" />
            </div>

            {/* Per-queue breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {['broadcast', 'workflow'].map(qName => {
                    const q = d.bullmq?.[qName] || {};
                    if (q.error) return (
                        <div key={qName} className="bg-red-500/10 border border-red-500/30 p-4 rounded-xl">
                            <span className="font-bold text-red-400 capitalize">{qName}:</span> <span className="text-red-400/80 text-sm">{q.error}</span>
                        </div>
                    );
                    return (
                        <div key={qName} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <i className={`fa-solid ${qName === 'broadcast' ? 'fa-tower-broadcast' : 'fa-diagram-project'}`} />
                                {qName} Queue
                            </h4>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                {['waiting', 'active', 'failed', 'completed', 'delayed', 'paused'].map(state => (
                                    <div key={state} className="text-xs">
                                        <div className="text-white font-bold text-lg">{q[state] || 0}</div>
                                        <div className="text-slate-500 capitalize">{state}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Agenda */}
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-4">Agenda Jobs</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <MetricCard label="Total" value={agenda.total || 0} icon="fa-list" />
                <MetricCard label="Pending" value={agenda.pending || 0} icon="fa-hourglass" />
                <MetricCard label="Active" value={agenda.active || 0} icon="fa-play" />
                <MetricCard label="Failed" value={agenda.failed || 0} icon="fa-xmark" status={(agenda.failed || 0) > 0 ? 'warning' : 'good'} />
                <MetricCard label="Automation Faults" value={agenda.automationFailures || 0} icon="fa-gears" status={(agenda.automationFailures || 0) > 5 ? 'critical' : 'good'} />
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 6: WORKERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WorkersTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/queues', activeTab, 'workers');

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    const workers = d.workers || [];

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Workers</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {workers.map((w, i) => (
                    <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5 hover:border-slate-600/70 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <StatusDot ok={w.running} />
                                <h3 className="text-white font-bold">{w.name}</h3>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-700/50 px-2 py-1 rounded">{w.type}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                                <span className="text-slate-500">Status</span>
                                <div className={`font-bold ${w.running ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {w.running ? 'Running' : 'Stopped'}
                                </div>
                            </div>
                            {w.concurrency && (
                                <div>
                                    <span className="text-slate-500">Concurrency</span>
                                    <div className="text-white font-bold">{w.concurrency}</div>
                                </div>
                            )}
                            {w.interval && (
                                <div>
                                    <span className="text-slate-500">Interval</span>
                                    <div className="text-white font-bold">{w.interval}</div>
                                </div>
                            )}
                            {w.paused !== undefined && (
                                <div>
                                    <span className="text-slate-500">Paused</span>
                                    <div className={`font-bold ${w.paused ? 'text-amber-400' : 'text-emerald-400'}`}>{w.paused ? 'Yes' : 'No'}</div>
                                </div>
                            )}
                        </div>
                        {w.error && <div className="mt-3 text-xs text-red-400/80 font-mono">{w.error}</div>}
                    </div>
                ))}
            </div>

            <MetricCard label="Server Uptime" value={formatUptime(d.serverUptime)} icon="fa-clock-rotate-left" className="max-w-xs" />
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 7: WEBHOOKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const WebhooksTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/webhooks', activeTab, 'webhooks');

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    const meta = d.meta || {};
    const rp   = d.razorpay || {};
    const wa   = d.whatsapp || {};
    const em   = d.email || {};

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Webhooks</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Meta / WhatsApp Webhooks</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Success Rate" value={`${meta.successRatePercent || 100}%`} icon="fa-circle-check"
                    status={(meta.successRatePercent || 100) < 95 ? 'critical' : 'good'} />
                <MetricCard label="Avg Latency" value={`${meta.avgLatencyMs || 0}`} suffix="ms" icon="fa-clock" />
                <MetricCard label="Failed" value={meta.failed || 0} icon="fa-circle-xmark" status={(meta.failed || 0) > 0 ? 'warning' : 'good'} />
                <MetricCard label="Retries" value={meta.totalRetries || 0} icon="fa-rotate" />
            </div>

            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-4">WhatsApp Delivery (24h)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Sent" value={wa.sent24h || 0} icon="fa-paper-plane" status="good" />
                <MetricCard label="Failed" value={wa.failed24h || 0} icon="fa-xmark" status={(wa.failed24h || 0) > 0 ? 'warning' : 'good'} />
                <MetricCard label="Success Rate" value={`${wa.successRate || 100}%`} icon="fa-bullseye"
                    status={(wa.successRate || 100) < 93 ? 'critical' : 'good'} />
                <MetricCard label="Total Attempts" value={wa.totalAttempts || 0} icon="fa-arrow-right-arrow-left" />
            </div>

            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-4">Razorpay Billing</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <MetricCard label="Status" value={rp.healthy ? 'Healthy' : 'Issues'} icon="fa-credit-card"
                    status={rp.healthy ? 'good' : 'critical'} />
                <MetricCard label="Consecutive Failures" value={rp.consecutiveFailures || 0} icon="fa-link-slash"
                    status={(rp.consecutiveFailures || 0) > 0 ? 'critical' : 'good'} />
                <MetricCard label="Last Alert" value={rp.lastAlertAt ? new Date(rp.lastAlertAt).toLocaleTimeString() : 'None'} icon="fa-bell" />
            </div>

            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mt-4">Email Delivery (24h)</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Sent" value={em.sent24h || 0} icon="fa-envelope" status="good" />
                <MetricCard label="Failed" value={em.failed24h || 0} icon="fa-envelope-circle-xmark" status={(em.failed24h || 0) > 0 ? 'warning' : 'good'} />
                <MetricCard label="Success Rate" value={`${em.successRate || 100}%`} icon="fa-bullseye"
                    status={(em.successRate || 100) < 90 ? 'critical' : 'good'} />
                <MetricCard label="Total Attempts" value={em.totalAttempts || 0} icon="fa-arrow-right-arrow-left" />
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 8: LIVE LOGS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const LiveLogsTab = ({ activeTab }) => {
    const [filter, setFilter] = useState(null);
    const { data: d, loading, error, refetch } = useTabData(
        `/superadmin/system-health/logs${filter ? `?filter=${filter}` : ''}`,
        activeTab, 'logs', 10000
    );

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    const counts = d.counts || {};
    const logs   = d.logs || [];

    const levelColors = {
        error:     'text-red-400 bg-red-500/10',
        warning:   'text-amber-400 bg-amber-500/10',
        info:      'text-blue-400 bg-blue-500/10',
        exception: 'text-purple-400 bg-purple-500/10'
    };

    const filterBtns = [
        { key: null,         label: 'All',        count: counts.error + counts.warning + counts.info + counts.exception },
        { key: 'error',      label: 'Errors',     count: counts.error },
        { key: 'warning',    label: 'Warnings',   count: counts.warning },
        { key: 'exception',  label: 'Exceptions', count: counts.exception }
    ];

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Live Logs</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            {/* Filter buttons */}
            <div className="flex gap-2 flex-wrap">
                {filterBtns.map(btn => (
                    <button key={btn.key || 'all'} onClick={() => setFilter(btn.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                            filter === btn.key
                                ? 'bg-white/10 text-white ring-1 ring-white/20'
                                : 'bg-slate-800/60 text-slate-400 hover:bg-slate-700/60'
                        }`}>
                        {btn.label} <span className="ml-1 text-[10px] opacity-70">({btn.count})</span>
                    </button>
                ))}
            </div>

            {/* Log entries */}
            <div className="space-y-1 max-h-[500px] overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-900/50 p-2">
                {logs.length === 0 ? (
                    <div className="text-center text-slate-500 py-12 font-mono">
                        <i className="fa-solid fa-inbox text-3xl mb-3" /><br />
                        No logs recorded yet
                    </div>
                ) : logs.map((log, i) => (
                    <div key={i} className="flex gap-3 items-start px-3 py-2 rounded-lg hover:bg-slate-800/50 transition-colors text-xs font-mono group">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold whitespace-nowrap ${levelColors[log.level] || ''}`}>
                            {log.level}
                        </span>
                        <span className="text-slate-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        <span className="text-slate-300 break-all">{log.message}</span>
                        {log.meta?.statusCode && (
                            <span className="text-slate-600 whitespace-nowrap ml-auto hidden group-hover:inline">{log.meta.statusCode}</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 9: ALERTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const AlertsTab = ({ activeTab }) => {
    const { data: h, loading, error, refetch } = useTabData('/superadmin/system-health', activeTab, 'alerts', 30000);

    if (loading && !h) return <TabLoader />;
    if (error && !h) return <TabError msg={error} onRetry={refetch} />;
    if (!h) return null;

    const alert = h.alertStatus || { level: 'healthy', triggers: [] };
    const triggers = alert.triggers || [];

    const exampleRules = [
        { emoji: '🔴', rule: 'CPU > 90%',                condition: 'critical' },
        { emoji: '🔴', rule: 'Mongo Down',               condition: 'critical' },
        { emoji: '🔴', rule: 'Redis Down',               condition: 'critical' },
        { emoji: '🔴', rule: 'API Error Rate > 5%',      condition: 'critical' },
        { emoji: '🔴', rule: 'RAM > 90%',                condition: 'critical' },
        { emoji: '🔴', rule: 'DB Storage > 95%',         condition: 'critical' },
        { emoji: '🔴', rule: 'DB Connections > 400',     condition: 'critical' },
        { emoji: '🟡', rule: 'Queue > 1,000 Waiting',    condition: 'warning' },
        { emoji: '🟡', rule: 'Response Time > 1s',       condition: 'warning' },
        { emoji: '🟡', rule: 'CPU > 70%',                condition: 'warning' },
        { emoji: '🟡', rule: 'RAM > 75%',                condition: 'warning' },
        { emoji: '🟡', rule: 'API Error Rate > 2%',      condition: 'warning' },
        { emoji: '🟡', rule: 'DB Storage > 80%',         condition: 'warning' }
    ];

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Alerts</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            {/* Current Status */}
            <div className={`p-6 rounded-xl border-l-4 ${
                alert.level === 'healthy'  ? 'bg-emerald-500/10 border-emerald-500' :
                alert.level === 'warning'  ? 'bg-amber-500/10 border-amber-500' :
                                             'bg-red-500/10 border-red-500'
            }`}>
                <div className="flex items-center gap-3 mb-3">
                    <i className={`fa-solid text-2xl ${
                        alert.level === 'healthy' ? 'fa-check-circle text-emerald-400' :
                        alert.level === 'warning' ? 'fa-triangle-exclamation text-amber-400' :
                                                    'fa-radiation text-red-400'
                    }`} />
                    <span className={`text-xl font-black uppercase ${
                        alert.level === 'healthy' ? 'text-emerald-400' :
                        alert.level === 'warning' ? 'text-amber-400' : 'text-red-400'
                    }`}>{alert.level}</span>
                </div>

                {triggers.length > 0 ? (
                    <div className="space-y-2">
                        {triggers.map((t, i) => (
                            <div key={i} className={`flex items-center gap-3 text-sm font-mono px-3 py-2 rounded-lg ${
                                t.level === 'critical' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                            }`}>
                                <span className="text-base">{t.emoji || '⚠️'}</span>
                                <span>{t.message}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-emerald-400/80 font-mono text-sm">All systems operating normally. No active alerts.</p>
                )}
            </div>

            {/* Alert Rules Reference */}
            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Alert Rules</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {exampleRules.map((r, i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-mono ${
                        r.condition === 'critical' ? 'bg-red-500/5 text-slate-400 border border-red-500/20' : 'bg-amber-500/5 text-slate-400 border border-amber-500/20'
                    }`}>
                        <span className="text-base">{r.emoji}</span>
                        <span>{r.rule}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TAB 10: SYSTEM INFO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SystemInfoTab = ({ activeTab }) => {
    const { data: d, loading, error, refetch } = useTabData('/superadmin/system-health/system-info', activeTab, 'system-info');

    if (loading && !d) return <TabLoader />;
    if (error && !d) return <TabError msg={error} onRetry={refetch} />;
    if (!d) return null;

    const infoRows = [
        { label: 'App Version',    value: d.version,     icon: 'fa-code-branch' },
        { label: 'Environment',    value: d.environment, icon: 'fa-leaf' },
        { label: 'Build',          value: d.build,       icon: 'fa-hammer' },
        { label: 'Node Version',   value: d.nodeVersion, icon: 'fa-node-js' },
        { label: 'Mongo Version',  value: d.mongoVersion, icon: 'fa-database' },
        { label: 'Redis Version',  value: d.redisVersion, icon: 'fa-server' },
        { label: 'Server Uptime',  value: formatUptime(d.serverUptime), icon: 'fa-clock-rotate-left' },
        { label: 'Platform',       value: `${d.platform} / ${d.arch}`, icon: 'fa-desktop' },
        { label: 'Hostname',       value: d.hostname,    icon: 'fa-network-wired' },
        { label: 'CPU Cores',      value: d.cpuCores,    icon: 'fa-microchip' },
        { label: 'Total Memory',   value: `${d.totalMemoryMB} MB`, icon: 'fa-memory' }
    ];

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-black text-white uppercase tracking-widest">System Information</h2>
                <button onClick={refetch} className="text-slate-400 hover:text-white text-sm transition"><i className="fa-solid fa-rotate mr-1" />Refresh</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {infoRows.map((row, i) => (
                    <div key={i} className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-5 py-4 flex items-center gap-4 hover:border-slate-600/70 transition-all">
                        <div className="w-10 h-10 bg-slate-700/50 rounded-lg flex items-center justify-center flex-shrink-0">
                            <i className={`fa-solid ${row.icon} text-slate-400`} />
                        </div>
                        <div>
                            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">{row.label}</div>
                            <div className="text-white font-bold font-mono">{row.value || 'N/A'}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN COMPONENT: SystemHealthView with Tab Navigation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TABS = [
    { key: 'overview',    icon: 'fa-gauge-high',          label: 'Overview' },
    { key: 'api',         icon: 'fa-bolt',                label: 'API Performance' },
    { key: 'database',    icon: 'fa-database',            label: 'Database' },
    { key: 'redis',       icon: 'fa-server',              label: 'Redis' },
    { key: 'queues',      icon: 'fa-layer-group',         label: 'Queue Monitor' },
    { key: 'workers',     icon: 'fa-gears',               label: 'Workers' },
    { key: 'webhooks',    icon: 'fa-plug',                label: 'Webhooks' },
    { key: 'logs',        icon: 'fa-terminal',            label: 'Live Logs' },
    { key: 'alerts',      icon: 'fa-bell',                label: 'Alerts' },
    { key: 'system-info', icon: 'fa-circle-info',         label: 'System Info' }
];

const SystemHealthView = () => {
    const [activeTab, setActiveTab] = useState('overview');

    const renderTab = () => {
        switch (activeTab) {
            case 'overview':     return <OverviewTab activeTab={activeTab} />;
            case 'api':          return <ApiPerformanceTab activeTab={activeTab} />;
            case 'database':     return <DatabaseTab activeTab={activeTab} />;
            case 'redis':        return <RedisTab activeTab={activeTab} />;
            case 'queues':       return <QueueMonitorTab activeTab={activeTab} />;
            case 'workers':      return <WorkersTab activeTab={activeTab} />;
            case 'webhooks':     return <WebhooksTab activeTab={activeTab} />;
            case 'logs':         return <LiveLogsTab activeTab={activeTab} />;
            case 'alerts':       return <AlertsTab activeTab={activeTab} />;
            case 'system-info':  return <SystemInfoTab activeTab={activeTab} />;
            default:             return <OverviewTab activeTab={activeTab} />;
        }
    };

    return (
        <div className="min-h-screen bg-slate-900 -m-8 p-6">
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-3 mb-1">
                    <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                        <i className="fa-solid fa-heartbeat text-white text-lg" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-white tracking-wide">System Monitor</h1>
                        <p className="text-xs text-slate-500 font-mono">Real-time infrastructure telemetry</p>
                    </div>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="mb-6 overflow-x-auto pb-1">
                <div className="flex gap-1 min-w-max bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                                activeTab === tab.key
                                    ? 'bg-white text-slate-900 shadow-lg shadow-white/10'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                            }`}
                        >
                            <i className={`fa-solid ${tab.icon} text-[11px]`} />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Active Tab Content */}
            <div className="transition-all duration-300">
                {renderTab()}
            </div>
        </div>
    );
};

export default SystemHealthView;
