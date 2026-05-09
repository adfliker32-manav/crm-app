/* eslint-disable no-unused-vars */
import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import useSocket from '../hooks/useSocket';

const STATUS_COLORS = {
    Pending:   'bg-amber-100 text-amber-700',
    Confirmed: 'bg-green-100 text-green-700',
    Cancelled: 'bg-red-100 text-red-700',
    Completed: 'bg-blue-100 text-blue-700',
    'No-Show': 'bg-slate-100 text-slate-500'
};

const DAY_OPTIONS = [
    { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 }
];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function toDateStr(d) {
    const y  = d.getFullYear();
    const m  = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
}

// ─── Appointments List Tab ───────────────────────────────────────────────────

function AppointmentsList() {
    const { showSuccess, showError } = useNotification();
    const { socket } = useSocket();
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading]           = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [dateFilter, setDateFilter]     = useState('upcoming');
    const [search, setSearch]             = useState('');
    const [selectedAppt, setSelectedAppt] = useState(null);
    const [updatingId, setUpdatingId]     = useState(null);

    useEffect(() => {
        if (!socket) return;
        const handler = (newAppt) => {
            setAppointments(prev => [newAppt, ...prev]);
            showSuccess(`📅 New booking: ${newAppt.customerName} — ${newAppt.serviceType}`);
        };
        socket.on('appointment:new', handler);
        return () => socket.off('appointment:new', handler);
    }, [socket]);

    const fetchAppointments = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (dateFilter !== 'all')   params.set('date', dateFilter);
            if (search)                 params.set('search', search);
            const res = await api.get(`/appointments?${params.toString()}`);
            setAppointments(res.data || []);
        } catch {
            showError('Failed to load appointments');
        } finally {
            setLoading(false);
        }
    }, [statusFilter, dateFilter, search]);

    useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

    const updateStatus = async (apptId, newStatus) => {
        setUpdatingId(apptId);
        try {
            const res = await api.put(`/appointments/${apptId}`, { status: newStatus });
            setAppointments(prev => prev.map(a => a._id === apptId ? res.data : a));
            if (selectedAppt?._id === apptId) setSelectedAppt(res.data);
            showSuccess(`Marked as ${newStatus}`);
        } catch {
            showError('Failed to update status');
        } finally {
            setUpdatingId(null);
        }
    };

    const deleteAppt = async (apptId) => {
        if (!window.confirm('Delete this appointment?')) return;
        try {
            await api.delete(`/appointments/${apptId}`);
            setAppointments(prev => prev.filter(a => a._id !== apptId));
            if (selectedAppt?._id === apptId) setSelectedAppt(null);
            showSuccess('Appointment deleted');
        } catch {
            showError('Failed to delete');
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
        });
    };

    return (
        <div className="flex gap-4 h-full">
            <div className="flex-1 flex flex-col min-w-0">
                <div className="flex flex-wrap gap-2 mb-4">
                    <input type="text" placeholder="Search name, phone..." value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 flex-1 min-w-36" />
                    <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                        <option value="all">All Dates</option>
                        <option value="today">Today</option>
                        <option value="upcoming">Upcoming</option>
                        <option value="past">Past</option>
                    </select>
                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                        <option value="all">All Status</option>
                        <option value="Pending">Pending</option>
                        <option value="Confirmed">Confirmed</option>
                        <option value="Cancelled">Cancelled</option>
                        <option value="Completed">Completed</option>
                        <option value="No-Show">No-Show</option>
                    </select>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : appointments.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                        <span className="text-5xl">📅</span>
                        <p className="font-medium">No appointments found</p>
                        <p className="text-sm">Share your booking link to get started</p>
                    </div>
                ) : (
                    <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                        {appointments.map(appt => (
                            <div key={appt._id} onClick={() => setSelectedAppt(appt)}
                                className={`bg-white border rounded-xl p-4 cursor-pointer transition-all hover:border-blue-300 hover:shadow-sm
                                    ${selectedAppt?._id === appt._id ? 'border-blue-500 shadow-sm' : 'border-slate-200'}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-semibold text-slate-800 text-sm">{appt.customerName}</p>
                                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[appt.status] || 'bg-slate-100 text-slate-500'}`}>
                                                {appt.status}
                                            </span>
                                        </div>
                                        <p className="text-slate-500 text-xs mt-0.5">{appt.customerPhone}</p>
                                        <p className="text-slate-600 text-xs mt-1 font-medium">{appt.serviceType}</p>
                                        <p className="text-slate-400 text-xs mt-0.5">
                                            {formatDate(appt.appointmentDate)} · {appt.appointmentTime}
                                        </p>
                                    </div>
                                    <div className="flex gap-1.5 shrink-0">
                                        {appt.status === 'Pending' && (
                                            <button onClick={e => { e.stopPropagation(); updateStatus(appt._id, 'Confirmed'); }}
                                                disabled={updatingId === appt._id}
                                                className="text-[10px] bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded-lg font-semibold disabled:opacity-50">
                                                Confirm
                                            </button>
                                        )}
                                        <button onClick={e => { e.stopPropagation(); deleteAppt(appt._id); }}
                                            className="text-[10px] text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg transition-colors">
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedAppt && (
                <div className="w-80 shrink-0 bg-white border border-slate-200 rounded-xl p-5 overflow-y-auto">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-slate-800">Appointment Details</h3>
                        <button onClick={() => setSelectedAppt(null)} className="text-slate-400 hover:text-slate-600">
                            <i className="fa-solid fa-xmark text-sm"></i>
                        </button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <DetailRow label="Customer" value={selectedAppt.customerName} />
                        <DetailRow label="Phone"    value={selectedAppt.customerPhone} />
                        {selectedAppt.customerEmail && <DetailRow label="Email" value={selectedAppt.customerEmail} />}
                        <DetailRow label="Service"  value={selectedAppt.serviceType} />
                        <DetailRow label="Date"     value={formatDate(selectedAppt.appointmentDate)} />
                        <DetailRow label="Time"     value={selectedAppt.appointmentTime} />
                        <DetailRow label="Source"   value={selectedAppt.source} />
                        {selectedAppt.notes && <DetailRow label="Notes" value={selectedAppt.notes} />}
                        <div>
                            <span className="text-slate-500 text-xs block mb-1">Status</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[selectedAppt.status]}`}>
                                {selectedAppt.status}
                            </span>
                        </div>
                        {selectedAppt.confirmationSent && (
                            <p className="text-xs text-green-600 flex items-center gap-1">
                                <i className="fa-solid fa-check-circle"></i> WhatsApp confirmation sent
                            </p>
                        )}
                    </div>
                    <div className="mt-5 space-y-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Change Status</p>
                        <div className="flex flex-wrap gap-2">
                            {['Pending','Confirmed','Completed','Cancelled','No-Show'].map(s => (
                                <button key={s}
                                    onClick={() => updateStatus(selectedAppt._id, s)}
                                    disabled={selectedAppt.status === s || updatingId === selectedAppt._id}
                                    className={`text-xs px-3 py-1 rounded-lg border font-medium transition-all disabled:opacity-40
                                        ${selectedAppt.status === s ? 'bg-blue-500 text-white border-blue-500' : 'border-slate-200 text-slate-600 hover:border-blue-300'}`}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function DetailRow({ label, value }) {
    return (
        <div>
            <span className="text-slate-400 text-xs">{label}</span>
            <p className="text-slate-700 font-medium mt-0.5">{value}</p>
        </div>
    );
}

// ─── Calendar Tab ────────────────────────────────────────────────────────────

function getCalendarDays(year, month) {
    const firstDay     = new Date(year, month, 1).getDay();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const prevTotal    = new Date(year, month, 0).getDate();
    const days = [];

    for (let i = firstDay - 1; i >= 0; i--)
        days.push({ date: new Date(year, month - 1, prevTotal - i), isCurrentMonth: false });

    for (let i = 1; i <= daysInMonth; i++)
        days.push({ date: new Date(year, month, i), isCurrentMonth: true });

    let next = 1;
    while (days.length < 42)
        days.push({ date: new Date(year, month + 1, next++), isCurrentMonth: false });

    return days;
}

function CalendarTab() {
    const { showSuccess, showError } = useNotification();

    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const [selectedDate, setSelectedDate]     = useState(null);   // "YYYY-MM-DD"
    const [calData, setCalData]               = useState({ appointments: {}, blockedSlots: [] });
    const [bpConfig, setBpConfig]             = useState(null);
    const [loading, setLoading]               = useState(true);
    const [blocking, setBlocking]             = useState(false);

    const year     = currentMonth.getFullYear();
    const month    = currentMonth.getMonth();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    const fetchCalendar = useCallback(async () => {
        setLoading(true);
        try {
            const [calRes, bpRes] = await Promise.all([
                api.get(`/appointments/calendar?month=${monthStr}`),
                api.get('/appointments/booking-page/config')
            ]);
            setCalData(calRes.data);
            setBpConfig(bpRes.data);
        } catch {
            showError('Failed to load calendar');
        } finally {
            setLoading(false);
        }
    }, [monthStr]);

    useEffect(() => { fetchCalendar(); }, [fetchCalendar]);

    const days = getCalendarDays(year, month);

    // Per-day derived data
    const dayAppointments = selectedDate ? (calData.appointments[selectedDate] || []) : [];
    const dayBlocked      = selectedDate ? calData.blockedSlots.filter(b => b.date === selectedDate) : [];
    const isDayBlocked    = dayBlocked.some(b => !b.time);
    const blockedTimes    = new Set(dayBlocked.filter(b => b.time).map(b => b.time));

    const blockDay = async () => {
        setBlocking(true);
        try {
            await api.post('/appointments/blocked-slots', { date: selectedDate, time: null });
            showSuccess('Day blocked');
            fetchCalendar();
        } catch { showError('Failed to block day'); }
        finally { setBlocking(false); }
    };

    const unblockDay = async () => {
        const doc = dayBlocked.find(b => !b.time);
        if (!doc) return;
        setBlocking(true);
        try {
            await api.delete(`/appointments/blocked-slots/${doc._id}`);
            showSuccess('Day unblocked');
            fetchCalendar();
        } catch { showError('Failed to unblock'); }
        finally { setBlocking(false); }
    };

    const toggleSlot = async (time) => {
        setBlocking(true);
        try {
            const existing = dayBlocked.find(b => b.time === time);
            if (existing) {
                await api.delete(`/appointments/blocked-slots/${existing._id}`);
                showSuccess('Slot unblocked');
            } else {
                await api.post('/appointments/blocked-slots', { date: selectedDate, time });
                showSuccess('Slot blocked');
            }
            fetchCalendar();
        } catch { showError('Failed to toggle slot'); }
        finally { setBlocking(false); }
    };

    const prevMonth = () => setCurrentMonth(new Date(year, month - 1, 1));
    const nextMonth = () => setCurrentMonth(new Date(year, month + 1, 1));

    const today = toDateStr(new Date());

    return (
        <div className="flex gap-4 h-full">
            {/* Calendar grid */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Month nav */}
                <div className="flex items-center justify-between mb-4">
                    <button onClick={prevMonth} className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors">
                        <i className="fa-solid fa-chevron-left text-xs"></i>
                    </button>
                    <h3 className="font-bold text-slate-800">{MONTH_NAMES[month]} {year}</h3>
                    <button onClick={nextMonth} className="w-8 h-8 rounded-lg border border-slate-200 hover:bg-slate-100 flex items-center justify-center text-slate-600 transition-colors">
                        <i className="fa-solid fa-chevron-right text-xs"></i>
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                ) : (
                    <>
                        {/* Day headers */}
                        <div className="grid grid-cols-7 mb-1">
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                                <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>
                            ))}
                        </div>

                        {/* Days grid */}
                        <div className="grid grid-cols-7 gap-1 flex-1 content-start">
                            {days.map(({ date, isCurrentMonth }) => {
                                const ds         = toDateStr(date);
                                const apptCount  = (calData.appointments[ds] || []).length;
                                const dayBlock   = calData.blockedSlots.filter(b => b.date === ds);
                                const allDay     = dayBlock.some(b => !b.time);
                                const hasSlotBlk = !allDay && dayBlock.some(b => b.time);
                                const isSelected = selectedDate === ds;
                                const isToday    = ds === today;

                                return (
                                    <button
                                        key={ds}
                                        onClick={() => setSelectedDate(isSelected ? null : ds)}
                                        className={`relative p-1.5 rounded-xl text-sm font-medium transition-all min-h-[52px] flex flex-col items-center gap-0.5
                                            ${!isCurrentMonth ? 'text-slate-300' : 'text-slate-700'}
                                            ${isSelected ? 'bg-blue-600 text-white' : allDay ? 'bg-red-50 border border-red-200' : 'hover:bg-slate-100 border border-transparent'}
                                            ${isToday && !isSelected ? 'border-blue-400 border' : ''}`}
                                    >
                                        <span className={`text-xs leading-none ${isToday && !isSelected ? 'font-bold text-blue-600' : ''} ${isSelected ? 'text-white' : ''}`}>
                                            {date.getDate()}
                                        </span>

                                        {apptCount > 0 && (
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-none
                                                ${isSelected ? 'bg-white/30 text-white' : 'bg-blue-100 text-blue-700'}`}>
                                                {apptCount}
                                            </span>
                                        )}

                                        {allDay && !isSelected && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 absolute top-1.5 right-1.5"></span>
                                        )}
                                        {hasSlotBlk && !isSelected && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 absolute top-1.5 right-1.5"></span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Legend */}
                        <div className="flex gap-4 mt-3 text-xs text-slate-400">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> Appointments</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> Day blocked</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span> Slots blocked</span>
                        </div>
                    </>
                )}
            </div>

            {/* Day panel */}
            {selectedDate && (
                <div className="w-80 shrink-0 bg-white border border-slate-200 rounded-xl p-5 overflow-y-auto flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="font-bold text-slate-800 text-sm">
                                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </h3>
                            {isDayBlocked && (
                                <span className="text-xs font-semibold text-red-500 mt-0.5 block">Day blocked</span>
                            )}
                        </div>
                        <button onClick={() => setSelectedDate(null)} className="text-slate-400 hover:text-slate-600">
                            <i className="fa-solid fa-xmark text-sm"></i>
                        </button>
                    </div>

                    {/* Appointments */}
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                            Appointments ({dayAppointments.length})
                        </p>
                        {dayAppointments.length === 0 ? (
                            <p className="text-slate-400 text-xs">No appointments</p>
                        ) : (
                            <div className="space-y-2">
                                {dayAppointments.map(a => (
                                    <div key={a._id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-semibold text-slate-700 truncate">{a.customerName}</p>
                                            <p className="text-[11px] text-slate-400">{a.appointmentTime} · {a.serviceType}</p>
                                        </div>
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[a.status] || 'bg-slate-100 text-slate-500'}`}>
                                            {a.status}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Block / Availability controls */}
                    <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Availability</p>

                        {isDayBlocked ? (
                            <button onClick={unblockDay} disabled={blocking}
                                className="w-full text-xs bg-green-500 hover:bg-green-600 text-white font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
                                {blocking ? 'Saving...' : 'Unblock Entire Day'}
                            </button>
                        ) : (
                            <>
                                <button onClick={blockDay} disabled={blocking}
                                    className="w-full text-xs bg-red-500 hover:bg-red-600 text-white font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 mb-3">
                                    {blocking ? 'Saving...' : 'Block Entire Day'}
                                </button>

                                {bpConfig?.timeSlots?.length > 0 && (
                                    <>
                                        <p className="text-[11px] text-slate-400 mb-2">Or block individual slots:</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {bpConfig.timeSlots.map(slot => {
                                                const isBlocked = blockedTimes.has(slot.time);
                                                return (
                                                    <button key={slot.time} onClick={() => toggleSlot(slot.time)} disabled={blocking}
                                                        className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-50
                                                            ${isBlocked
                                                                ? 'bg-orange-100 border-orange-300 text-orange-700 line-through'
                                                                : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-orange-300'}`}>
                                                        {slot.time}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Booking Page Customizer Tab ─────────────────────────────────────────────

const SECTIONS = [
    { id: 'branding',      icon: 'fa-palette',       label: 'Branding' },
    { id: 'services',      icon: 'fa-briefcase',      label: 'Services' },
    { id: 'schedule',      icon: 'fa-calendar-days',  label: 'Schedule' },
    { id: 'slots',         icon: 'fa-clock',          label: 'Time Slots' },
    { id: 'notifications', icon: 'fa-bell',           label: 'Notifications' },
];

// Convert HH:MM (from <input type="time">) to "H:MM AM/PM"
function toAmPm(val) {
    if (!val) return '';
    const [h, m] = val.split(':').map(Number);
    const p = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${p}`;
}

function BookingPageCustomizer() {
    const { showSuccess, showError } = useNotification();
    const [config, setConfig]       = useState(null);
    const [loading, setLoading]     = useState(true);
    const [saving, setSaving]       = useState(false);
    const [activeSection, setActiveSection] = useState('branding');

    const [title, setTitle]                             = useState('');
    const [subtitle, setSubtitle]                       = useState('');
    const [businessName, setBusinessName]               = useState('');
    const [logoUrl, setLogoUrl]                         = useState('');
    const [primaryColor, setPrimaryColor]               = useState('#3b82f6');
    const [services, setServices]                       = useState([]);
    const [newService, setNewService]                   = useState('');
    const [availableDays, setAvailableDays]             = useState([1,2,3,4,5]);
    const [timeSlots, setTimeSlots]                     = useState([]);
    const [newTime, setNewTime]                         = useState('');
    const [leadStageId, setLeadStageId]                 = useState('');
    const [confirmationTemplateId, setConfirmationTemplateId] = useState('');
    const [stages, setStages]                           = useState([]);
    const [whatsappTemplates, setWhatsappTemplates]     = useState([]);
    const [sendConfirmation, setSendConfirmation]       = useState(true);
    const [isActive, setIsActive]                       = useState(true);
    const [maxAdvanceDays, setMaxAdvanceDays]           = useState(30);
    const [bufferMinutes, setBufferMinutes]             = useState(0);

    useEffect(() => {
        api.get('/appointments/booking-page/config')
            .then(res => {
                const d = res.data;
                setConfig(d);
                setTitle(d.title || '');
                setSubtitle(d.subtitle || '');
                setBusinessName(d.businessName || '');
                setLogoUrl(d.logoUrl || '');
                setPrimaryColor(d.primaryColor || '#3b82f6');
                setServices(d.services || []);
                setAvailableDays(d.availableDays || [1,2,3,4,5]);
                setTimeSlots(d.timeSlots || []);
                setLeadStageId(d.leadStageId || '');
                setConfirmationTemplateId(d.confirmationTemplateId || '');
                setSendConfirmation(d.sendConfirmation !== false);
                setIsActive(d.isActive !== false);
                setMaxAdvanceDays(d.maxAdvanceDays || 30);
                setBufferMinutes(d.bufferMinutes || 0);
            })
            .catch(() => showError('Failed to load booking page config'))
            .finally(() => setLoading(false));

        // Load CRM stages and approved WhatsApp templates for dropdown selections.
        api.get('/stages')
            .then(res => setStages(Array.isArray(res.data) ? res.data : []))
            .catch(() => {});

        api.get('/whatsapp/templates?status=APPROVED')
            .then(res => {
                const list = res.data?.templates || res.data?.data || [];
                const approved = Array.isArray(list) ? list.filter(t => t.status === 'APPROVED') : [];
                setWhatsappTemplates(approved);
            })
            .catch(() => {});
    }, []);

    const handleSave = async () => {
        if (sendConfirmation && !confirmationTemplateId) {
            showError('Select a WhatsApp template for confirmation');
            return;
        }

        setSaving(true);
        try {
            const res = await api.put('/appointments/booking-page/config', {
                title, subtitle, businessName, logoUrl, primaryColor, services,
                availableDays, timeSlots,
                leadStageId: leadStageId || null,
                confirmationTemplateId: confirmationTemplateId || null,
                sendConfirmation, isActive, maxAdvanceDays, bufferMinutes
            });
            setConfig(res.data);
            showSuccess('Booking page saved!');
        } catch {
            showError('Failed to save');
        } finally { setSaving(false); }
    };

    const addService     = () => {
        if (!newService.trim()) return;
        if (!services.includes(newService.trim())) setServices(p => [...p, newService.trim()]);
        setNewService('');
    };
    const removeService  = s => setServices(p => p.filter(x => x !== s));
    const addTimeSlot    = () => {
        if (!newTime) return;
        const formatted = toAmPm(newTime);
        if (!timeSlots.find(s => s.time === formatted)) setTimeSlots(p => [...p, { time: formatted }]);
        setNewTime('');
    };
    const removeTimeSlot = t => setTimeSlots(p => p.filter(s => s.time !== t));
    const toggleDay      = n => setAvailableDays(p =>
        p.includes(n) ? p.filter(d => d !== n) : [...p, n].sort()
    );

    if (loading) return (
        <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <div className="h-full flex flex-col max-w-5xl mx-auto">

            {/* ── Link Banner ── */}
            {config?.publicUrl && (
                <div className="mb-5 bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center gap-3 shadow-sm">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                        <a href={config.publicUrl} target="_blank" rel="noreferrer"
                            className="text-blue-600 hover:text-blue-700 hover:underline text-sm font-mono truncate transition-colors">
                            {config.publicUrl}
                        </a>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <a href={config.publicUrl} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all">
                            <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                            Open
                        </a>
                        <button onClick={() => { navigator.clipboard.writeText(config.publicUrl); showSuccess('Link copied!'); }}
                            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-all">
                            <i className="fa-regular fa-copy text-[10px]"></i>
                            Copy
                        </button>
                        <button
                            onClick={() => setIsActive(v => !v)}
                            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all
                                ${isActive
                                    ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
                            <i className={`fa-solid ${isActive ? 'fa-circle-check' : 'fa-circle-xmark'} text-[11px]`}></i>
                            {isActive ? 'Active' : 'Inactive'}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Body: Sidebar + Content ── */}
            <div className="flex gap-5 flex-1 min-h-0">

                {/* Sidebar nav */}
                <div className="w-48 shrink-0 flex flex-col gap-1">
                    {SECTIONS.map(s => (
                        <button key={s.id} onClick={() => setActiveSection(s.id)}
                            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-left transition-all
                                ${activeSection === s.id
                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                                    : 'text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm'}`}>
                            <i className={`fa-solid ${s.icon} text-xs w-4 text-center`}></i>
                            {s.label}
                        </button>
                    ))}

                    <div className="flex-1"></div>

                    <button onClick={handleSave} disabled={saving}
                        className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors shadow-md shadow-blue-200 flex items-center justify-center gap-2">
                        {saving
                            ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span> Saving…</>
                            : <><i className="fa-solid fa-floppy-disk text-xs"></i> Save Changes</>}
                    </button>
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto">

                    {/* ── Branding ── */}
                    {activeSection === 'branding' && (
                        <CSection icon="fa-palette" title="Page Branding"
                            desc="Customize how your booking page looks to customers.">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <CField label="Business Name" icon="fa-building">
                                    <input value={businessName} onChange={e => setBusinessName(e.target.value)}
                                        placeholder="My Business" className={iCls} />
                                </CField>
                                <CField label="Page Title" icon="fa-heading">
                                    <input value={title} onChange={e => setTitle(e.target.value)}
                                        placeholder="Book an Appointment" className={iCls} />
                                </CField>
                                <CField label="Tagline / Subtitle" icon="fa-quote-left" className="sm:col-span-2">
                                    <input value={subtitle} onChange={e => setSubtitle(e.target.value)}
                                        placeholder="Choose a service and pick a convenient time." className={iCls} />
                                </CField>
                                <CField label="Logo URL" icon="fa-image" className="sm:col-span-2">
                                    <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                                        placeholder="https://example.com/logo.png" className={iCls} />
                                    {logoUrl && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <img src={logoUrl} alt="logo preview"
                                                className="w-10 h-10 rounded-xl object-contain border border-slate-200 bg-slate-50 p-1"
                                                onError={e => e.target.style.display='none'} />
                                            <span className="text-xs text-slate-400">Logo preview</span>
                                        </div>
                                    )}
                                </CField>
                                <CField label="Brand Color" icon="fa-droplet" className="sm:col-span-2">
                                    <div className="flex items-center gap-3">
                                        <input type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                                            className="w-11 h-11 rounded-xl border-2 border-slate-200 cursor-pointer p-1 shrink-0" />
                                        <input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)}
                                            placeholder="#3b82f6" className={iCls} />
                                        <div className="w-11 h-11 rounded-xl border border-slate-200 shrink-0"
                                            style={{ backgroundColor: primaryColor }}></div>
                                    </div>
                                    <div className="flex gap-2 mt-2 flex-wrap">
                                        {['#3b82f6','#10b981','#8b5cf6','#f59e0b','#ef4444','#ec4899','#0ea5e9','#1e293b'].map(c => (
                                            <button key={c} onClick={() => setPrimaryColor(c)}
                                                className={`w-7 h-7 rounded-lg border-2 transition-all ${primaryColor === c ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105'}`}
                                                style={{ backgroundColor: c }} title={c} />
                                        ))}
                                    </div>
                                </CField>
                            </div>
                        </CSection>
                    )}

                    {/* ── Services ── */}
                    {activeSection === 'services' && (
                        <CSection icon="fa-briefcase" title="Services Offered"
                            desc="List the services customers can book. They'll pick one when booking.">
                            <div className="flex flex-wrap gap-2 mb-4 min-h-[44px]">
                                {services.length === 0 && (
                                    <p className="text-slate-300 text-sm">No services added yet.</p>
                                )}
                                {services.map(svc => (
                                    <span key={svc}
                                        className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium px-3.5 py-2 rounded-xl">
                                        {svc}
                                        <button onClick={() => removeService(svc)}
                                            className="w-4 h-4 rounded-full bg-blue-200 hover:bg-red-100 hover:text-red-500 flex items-center justify-center transition-colors">
                                            <i className="fa-solid fa-xmark text-[9px]"></i>
                                        </button>
                                    </span>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input value={newService} onChange={e => setNewService(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && addService()}
                                    placeholder="e.g. Site Visit, Online Consultation…"
                                    className={`${iCls} flex-1`} />
                                <button onClick={addService}
                                    className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                                    + Add
                                </button>
                            </div>
                        </CSection>
                    )}

                    {/* ── Schedule ── */}
                    {activeSection === 'schedule' && (
                        <CSection icon="fa-calendar-days" title="Schedule Settings"
                            desc="Configure which days you're available and booking rules.">

                            <div className="mb-6">
                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available Days</p>
                                <div className="flex gap-2 flex-wrap">
                                    {DAY_OPTIONS.map(d => (
                                        <button key={d.value} onClick={() => toggleDay(d.value)}
                                            className={`w-12 h-12 rounded-xl text-xs font-bold border-2 transition-all flex flex-col items-center justify-center gap-0.5
                                                ${availableDays.includes(d.value)
                                                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200'
                                                    : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300 hover:text-blue-500'}`}>
                                            {d.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <CField label="Max Advance Booking" icon="fa-forward">
                                    <div className="flex items-center gap-2">
                                        <input type="number" min={1} max={365} value={maxAdvanceDays}
                                            onChange={e => setMaxAdvanceDays(Number(e.target.value))}
                                            className={`${iCls} w-24`} />
                                        <span className="text-sm text-slate-400">days ahead</span>
                                    </div>
                                </CField>

                                <CField label="Buffer Between Bookings" icon="fa-hourglass-half">
                                    <select value={bufferMinutes} onChange={e => setBufferMinutes(Number(e.target.value))}
                                        className={iCls}>
                                        <option value={0}>No buffer</option>
                                        <option value={15}>15 min gap</option>
                                        <option value={30}>30 min gap</option>
                                        <option value={45}>45 min gap</option>
                                        <option value={60}>60 min gap</option>
                                    </select>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Prevents back-to-back bookings without a gap.
                                    </p>
                                </CField>
                            </div>
                        </CSection>
                    )}

                    {/* ── Time Slots ── */}
                    {activeSection === 'slots' && (
                        <CSection icon="fa-clock" title="Time Slots"
                            desc="Define the appointment times customers can choose from.">
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4 min-h-[44px]">
                                {timeSlots.length === 0 && (
                                    <p className="text-slate-300 text-sm col-span-4">No time slots added yet.</p>
                                )}
                                {timeSlots.map(slot => (
                                    <div key={slot.time}
                                        className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                                        <span className="text-xs font-semibold text-slate-700">{slot.time}</span>
                                        <button onClick={() => removeTimeSlot(slot.time)}
                                            className="text-slate-300 hover:text-red-400 transition-colors ml-2">
                                            <i className="fa-solid fa-xmark text-[10px]"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <div className="flex gap-2">
                                <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
                                    className={`${iCls} flex-1`} />
                                <button onClick={addTimeSlot}
                                    className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                                    + Add
                                </button>
                            </div>
                            <p className="text-xs text-slate-400 mt-2">
                                Use the time picker to add slots. Times auto-format to AM/PM.
                            </p>
                        </CSection>
                    )}

                    {/* ── Notifications ── */}
                    {activeSection === 'notifications' && (
                        <CSection icon="fa-bell" title="WhatsApp Confirmation"
                            desc="Automatically send a WhatsApp message when a booking is made.">

                            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200 mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-green-100 flex items-center justify-center">
                                        <i className="fa-brands fa-whatsapp text-green-600 text-base"></i>
                                    </div>
                                    <div>
                                        <p className="text-sm font-semibold text-slate-700">Auto WhatsApp Message</p>
                                        <p className="text-xs text-slate-400">Sent immediately after booking</p>
                                    </div>
                                </div>
                                <button onClick={() => setSendConfirmation(v => !v)}
                                    className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none
                                        ${sendConfirmation ? 'bg-green-500' : 'bg-slate-300'}`}>
                                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all
                                        ${sendConfirmation ? 'left-[22px]' : 'left-0.5'}`}></span>
                                </button>
                            </div>

                            <CField label="Lead Stage (on booking)" icon="fa-diagram-project">
                                <select value={leadStageId || ''} onChange={e => setLeadStageId(e.target.value)}
                                    className={iCls}>
                                    <option value="">Don't change stage</option>
                                    {stages.map(s => (
                                        <option key={s._id} value={s._id}>{s.name}</option>
                                    ))}
                                </select>
                                <p className="text-xs text-slate-400 mt-1">
                                    When someone books, a lead is created automatically (if not already in your CRM). Select a stage to move that lead into.
                                </p>
                            </CField>

                            {sendConfirmation && (
                                <CField label="WhatsApp Template" icon="fa-file-lines">
                                    <select value={confirmationTemplateId || ''} onChange={e => setConfirmationTemplateId(e.target.value)}
                                        className={iCls}>
                                        <option value="">Select an approved templateâ€¦</option>
                                        {whatsappTemplates.map(t => (
                                            <option key={t._id} value={t._id}>
                                                {t.name}{t.language ? ` (${t.language})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {['{{1}} Name','{{2}} Date','{{3}} Time','{{4}} Service','{{5}} Business'].map(v => (
                                            <span key={v} className="text-[10px] font-mono bg-blue-50 border border-blue-200 text-blue-600 px-2 py-0.5 rounded-md">
                                                {v}
                                            </span>
                                        ))}
                                        <span className="text-xs text-slate-400 ml-1">template placeholders</span>
                                    </div>
                                </CField>
                            )}
                        </CSection>
                    )}
                </div>
            </div>
        </div>
    );
}

const iCls = 'w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent bg-white transition-shadow';

function CSection({ icon, title, desc, children }) {
    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-5 pb-5 border-b border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <i className={`fa-solid ${icon} text-blue-600 text-sm`}></i>
                </div>
                <div>
                    <h3 className="font-bold text-slate-800 text-base">{title}</h3>
                    {desc && <p className="text-xs text-slate-400 mt-0.5">{desc}</p>}
                </div>
            </div>
            {children}
        </div>
    );
}

function CField({ label, icon, children, className = '' }) {
    return (
        <div className={className}>
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                {icon && <i className={`fa-solid ${icon} text-[10px]`}></i>}
                {label}
            </label>
            {children}
        </div>
    );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Appointments() {
    const [activeTab, setActiveTab] = useState('bookings');
    const [stats, setStats]         = useState(null);

    useEffect(() => {
        api.get('/appointments/stats').then(res => setStats(res.data)).catch(() => {});
    }, []);

    return (
        <div className="flex flex-col h-full bg-slate-50">
            <div className="bg-white border-b border-slate-200 px-6 py-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">Appointments</h1>
                        <p className="text-sm text-slate-400">Manage bookings and customize your booking page</p>
                    </div>
                    {stats && (
                        <div className="flex gap-4">
                            <StatBadge label="Today"     value={stats.today}     color="blue" />
                            <StatBadge label="Pending"   value={stats.pending}   color="amber" />
                            <StatBadge label="Confirmed" value={stats.confirmed} color="green" />
                            <StatBadge label="Total"     value={stats.total}     color="slate" />
                        </div>
                    )}
                </div>

                <div className="flex gap-1 mt-4">
                    {[
                        { key: 'bookings',  label: 'Bookings',     icon: 'fa-solid fa-calendar-check' },
                        { key: 'calendar',  label: 'Calendar',     icon: 'fa-solid fa-calendar-days' },
                        { key: 'customize', label: 'Booking Page', icon: 'fa-solid fa-sliders' }
                    ].map(tab => (
                        <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
                                ${activeTab === tab.key
                                    ? 'bg-blue-600 text-white'
                                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}>
                            <i className={tab.icon}></i>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-hidden p-6">
                {activeTab === 'bookings'  && <AppointmentsList />}
                {activeTab === 'calendar'  && <CalendarTab />}
                {activeTab === 'customize' && <BookingPageCustomizer />}
            </div>
        </div>
    );
}

function StatBadge({ label, value, color }) {
    const colorMap = {
        blue:  'bg-blue-50 text-blue-700',
        amber: 'bg-amber-50 text-amber-700',
        green: 'bg-green-50 text-green-700',
        slate: 'bg-slate-100 text-slate-600'
    };
    return (
        <div className={`${colorMap[color]} px-3 py-1.5 rounded-lg text-center`}>
            <p className="text-lg font-bold leading-none">{value ?? 0}</p>
            <p className="text-xs mt-0.5">{label}</p>
        </div>
    );
}
