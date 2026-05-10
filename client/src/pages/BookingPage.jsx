/* eslint-disable no-unused-vars */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API_BASE  = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getDatesInRange(availableDays, maxAdvanceDays) {
    const dates = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const limit = maxAdvanceDays > 0 ? maxAdvanceDays : 30;
    for (let i = 0; i < limit; i++) {
        const d = new Date(today); d.setDate(today.getDate() + i);
        if (availableDays.includes(d.getDay())) dates.push(d);
    }
    return dates;
}

function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatFullDate(d) {
    return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getHour24(timeStr) {
    const parts = timeStr.trim().split(' ');
    const [h]   = parts[0].split(':').map(Number);
    const period = (parts[1] || '').toUpperCase();
    if (period === 'PM' && h !== 12) return h + 12;
    if (period === 'AM' && h === 12) return 0;
    return h;
}

function groupSlots(slots) {
    const groups = [
        { label: 'Morning',   icon: 'fa-sun',       slots: [] },
        { label: 'Afternoon', icon: 'fa-cloud-sun',  slots: [] },
        { label: 'Evening',   icon: 'fa-moon',       slots: [] },
    ];
    slots.forEach(slot => {
        const h = getHour24(slot.time);
        if (h < 12)      groups[0].slots.push(slot);
        else if (h < 17) groups[1].slots.push(slot);
        else             groups[2].slots.push(slot);
    });
    return groups.filter(g => g.slots.length > 0);
}

function StepIndicator({ step, primaryColor }) {
    const steps = [{ n: 1, label: 'Choose Slot' }, { n: 2, label: 'Your Details' }];
    return (
        <div className="flex items-center justify-center gap-2 py-5">
            {steps.map((s, i) => (
                <div key={s.n} className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                            ${step >= s.n ? 'text-white shadow-md' : 'bg-slate-100 text-slate-400'}`}
                            style={step >= s.n ? { backgroundColor: primaryColor } : {}}>
                            {step > s.n ? <i className="fa-solid fa-check text-xs"></i> : s.n}
                        </div>
                        <span className={`text-xs font-semibold hidden sm:block ${step >= s.n ? 'text-slate-800' : 'text-slate-400'}`}>
                            {s.label}
                        </span>
                    </div>
                    {i === 0 && <div className="w-8 sm:w-16 h-0.5 bg-slate-200 rounded mx-1"></div>}
                </div>
            ))}
        </div>
    );
}

function hexToRgba(hex, opacity) {
    const h = (hex || '#3b82f6').replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${opacity})`;
}

function SectionHeader({ icon, title, primaryColor }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: hexToRgba(primaryColor, 0.12) }}>
                <i className={`fa-solid ${icon} text-[10px]`} style={{ color: primaryColor }}></i>
            </div>
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">{title}</h3>
        </div>
    );
}

function FormField({ label, icon, children, hint }) {
    return (
        <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                {icon && <i className={`fa-solid ${icon} text-[10px]`}></i>}
                {label}
            </label>
            {children}
            {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
        </div>
    );
}

function SummaryRow({ icon, label, value, primaryColor }) {
    return (
        <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
                <i className={`fa-solid ${icon} text-[11px]`} style={{ color: primaryColor }}></i>
            </div>
            <div>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm font-bold text-slate-700 mt-0.5">{value}</p>
            </div>
        </div>
    );
}

function CustomQuestionField({ question, value, onChange, primaryColor }) {
    const label = `${question.question}${question.required ? ' *' : ''}`;
    const focusStyle = e => { e.target.style.borderColor = primaryColor; };
    const blurStyle  = e => { e.target.style.borderColor = '#e2e8f0'; };
    const inputCls   = 'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors bg-white';

    if (question.type === 'textarea') {
        return (
            <FormField label={label} icon="fa-message">
                <textarea value={value} onChange={e => onChange(e.target.value)}
                    placeholder="Your answer…" rows={3}
                    className={`${inputCls} resize-none`}
                    onFocus={focusStyle} onBlur={blurStyle} />
            </FormField>
        );
    }
    if (question.type === 'select') {
        return (
            <FormField label={label} icon="fa-list">
                <select value={value} onChange={e => onChange(e.target.value)}
                    className={inputCls} onFocus={focusStyle} onBlur={blurStyle}>
                    <option value="">Select an option…</option>
                    {(question.options || []).map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            </FormField>
        );
    }
    const iconMap = { phone: 'fa-phone', email: 'fa-envelope', text: 'fa-pen' };
    return (
        <FormField label={label} icon={iconMap[question.type] || 'fa-pen'}>
            <input
                type={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : 'text'}
                value={value} onChange={e => onChange(e.target.value)}
                placeholder="Your answer…"
                className={inputCls}
                onFocus={focusStyle} onBlur={blurStyle} />
        </FormField>
    );
}

export default function BookingPage() {
    const { slug }  = useParams();
    const [page, setPage]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');

    const [step, setStep]                       = useState(1);
    const [selectedService, setSelectedService] = useState('');
    const [selectedDate, setSelectedDate]       = useState(null);
    const [selectedTime, setSelectedTime]       = useState('');
    const [availableSlots, setAvailableSlots]   = useState([]);
    const [slotsLoading, setSlotsLoading]       = useState(false);

    const [name, setName]                     = useState('');
    const [phone, setPhone]                   = useState('');
    const [email, setEmail]                   = useState('');
    const [notes, setNotes]                   = useState('');
    const [customAnswers, setCustomAnswers]   = useState({});
    const [submitting, setSubmitting]         = useState(false);
    const [submitError, setSubmitError]       = useState('');

    useEffect(() => {
        axios.get(`${API_BASE}/book/${slug}`)
            .then(res  => { setPage(res.data); setLoading(false); })
            .catch(() => { setError('This booking page is not available.'); setLoading(false); });
    }, [slug]);

    const availableDates = useMemo(
        () => page ? getDatesInRange(page.availableDays || [1, 2, 3, 4, 5], page.maxAdvanceDays || 30) : [],
        [page?.availableDays, page?.maxAdvanceDays]
    );

    const fetchSlots = useCallback(async (date) => {
        if (!date || !slug) return;
        setSlotsLoading(true);
        setAvailableSlots([]);
        setSelectedTime('');
        try {
            const res = await axios.get(`${API_BASE}/book/${slug}/slots`, { params: { date: toDateStr(date) } });
            setAvailableSlots(res.data.slots || []);
        } catch {
            setAvailableSlots(page?.timeSlots || []);
        } finally {
            setSlotsLoading(false);
        }
    }, [slug, page?.timeSlots]);

    const handleDateSelect = (d) => { setSelectedDate(d); fetchSlots(d); };
    // Ensure we always have a valid hex color (never empty/null)
    const primaryColor = (page?.primaryColor && page.primaryColor.trim()) ? page.primaryColor.trim() : '#3b82f6';
    // CSS rgba helper for tinted backgrounds — avoids 8-char hex browser compatibility issues
    const colorBg = (opacity) => {
        const hex = primaryColor.replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${opacity})`;
    };
    const canContinue = selectedService && selectedDate && selectedTime;

    const handleSubmit = async () => {
        if (!name.trim() || !phone.trim()) {
            setSubmitError('Name and phone number are required.');
            return;
        }
        const requiredQs = (page?.customQuestions || []).filter(q => q.required);
        for (const q of requiredQs) {
            if (!customAnswers[q.id]?.trim()) {
                setSubmitError(`"${q.question}" is required.`);
                return;
            }
        }
        setSubmitting(true);
        setSubmitError('');
        try {
            const answersArray = (page?.customQuestions || [])
                .filter(q => customAnswers[q.id])
                .map(q => ({ questionId: q.id, question: q.question, answer: customAnswers[q.id] }));

            await axios.post(`${API_BASE}/book/${slug}/submit`, {
                customerName:    name,
                customerPhone:   phone,
                customerEmail:   email,
                serviceType:     selectedService,
                appointmentDate: toDateStr(selectedDate),
                appointmentTime: selectedTime,
                notes,
                customAnswers:   answersArray
            });
            setStep(3);
        } catch (err) {
            setSubmitError(err.response?.data?.message || 'Something went wrong. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="text-center">
                <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                    style={{ borderColor: primaryColor || '#3b82f6', borderTopColor: 'transparent' }}></div>
                <p className="text-slate-400 text-sm">Loading your booking page…</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="text-center max-w-sm">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <i className="fa-solid fa-calendar-xmark text-2xl text-slate-400"></i>
                </div>
                <h2 className="text-xl font-bold text-slate-700 mb-2">Page Not Found</h2>
                <p className="text-slate-500 text-sm">{error}</p>
            </div>
        </div>
    );

    const focusStyle = e => { e.target.style.borderColor = primaryColor; };
    const blurStyle  = e => { e.target.style.borderColor = '#e2e8f0'; };
    const inputCls   = 'w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors';

    return (
        <div className="min-h-screen" style={{ backgroundColor: '#f1f5f9' }}>

            {/* ── Header ── */}
            <div className="relative text-white overflow-hidden" style={{ backgroundColor: primaryColor }}>
                <div className="absolute inset-0 opacity-20"
                    style={{ background: 'radial-gradient(ellipse at 80% 10%, white 0%, transparent 60%)' }}></div>
                <div className="relative px-4 pt-10 pb-16 text-center max-w-lg mx-auto">
                    {page.logoUrl ? (
                        <img src={page.logoUrl} alt="logo"
                            className="w-16 h-16 object-contain rounded-2xl mx-auto mb-4 bg-white/20 p-2 shadow-xl ring-2 ring-white/25" />
                    ) : (
                        <div className="w-14 h-14 rounded-2xl bg-white/20 ring-2 ring-white/20 flex items-center justify-center mx-auto mb-4">
                            <i className="fa-solid fa-calendar-check text-2xl"></i>
                        </div>
                    )}
                    <h1 className="text-2xl font-extrabold tracking-tight">{page.title}</h1>
                    <p className="text-white/80 mt-1.5 text-sm max-w-xs mx-auto leading-relaxed">{page.subtitle}</p>
                    {page.businessName && (
                        <span className="inline-flex items-center gap-1.5 mt-3 bg-white/20 border border-white/20 rounded-full px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm">
                            <i className="fa-solid fa-building text-[9px] opacity-80"></i>
                            {page.businessName}
                        </span>
                    )}
                </div>
                {/* Wave */}
                <svg className="absolute bottom-0 w-full" viewBox="0 0 1440 36" preserveAspectRatio="none" style={{ height: 36, display: 'block' }}>
                    <path fill="#f1f5f9" d="M0,36 C480,0 960,0 1440,36 L1440,36 L0,36 Z" />
                </svg>
            </div>

            <div className="max-w-lg mx-auto px-4 pb-14">

                {/* Description */}
                {page.description && step !== 3 && (
                    <div className="mt-4 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                        <p className="text-slate-600 text-sm leading-relaxed">{page.description}</p>
                    </div>
                )}

                {/* ── Step 3: Success ── */}
                {step === 3 && (
                    <div className="pt-6 space-y-4">
                        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 text-center">
                            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg"
                                style={{ backgroundColor: primaryColor }}>
                                <i className="fa-solid fa-check text-white text-3xl"></i>
                            </div>
                            <h2 className="text-2xl font-extrabold text-slate-800 mb-2">You're all set!</h2>
                            <p className="text-slate-500 text-sm leading-relaxed mb-6 max-w-xs mx-auto">
                                {page.thankYouMessage
                                    ? page.thankYouMessage.replace('{{name}}', name)
                                    : `Hi ${name}, your appointment has been confirmed. We look forward to seeing you!`}
                            </p>

                            <div className="bg-slate-50 rounded-2xl p-5 text-left space-y-4 mb-6 border border-slate-100">
                                <SummaryRow icon="fa-briefcase" label="Service"  value={selectedService} primaryColor={primaryColor} />
                                <SummaryRow icon="fa-calendar" label="Date"     value={formatFullDate(selectedDate)} primaryColor={primaryColor} />
                                <SummaryRow icon="fa-clock"    label="Time"     value={selectedTime} primaryColor={primaryColor} />
                            </div>

                            <div className="flex items-center gap-2.5 justify-center text-sm text-green-600 font-semibold">
                                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                                    <i className="fa-brands fa-whatsapp text-green-600 text-base"></i>
                                </div>
                                Confirmation sent to your WhatsApp
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Step 1: Slot Selection ── */}
                {step === 1 && (
                    <div>
                        <StepIndicator step={1} primaryColor={primaryColor} />
                        <div className="space-y-4">

                            {/* Services */}
                            {(page.services || []).length > 0 && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                    <SectionHeader icon="fa-briefcase" title="Select Service" primaryColor={primaryColor} />
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {page.services.map(svc => {
                                            const isSel = selectedService === svc;
                                            return (
                                                <button key={svc} onClick={() => setSelectedService(svc)}
                                                    className={`group p-4 rounded-2xl border-2 transition-all text-left relative overflow-hidden
                                                        ${isSel
                                                            ? 'border-transparent shadow-lg scale-[1.01]'
                                                            : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-white hover:shadow-sm'}`}
                                                    style={isSel ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}>
                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold mb-2.5 transition-all
                                                        ${isSel ? 'bg-white/25 text-white' : 'bg-white text-slate-500 border border-slate-200 shadow-sm'}`}>
                                                        {svc.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className={`text-sm font-semibold leading-snug block ${isSel ? 'text-white' : 'text-slate-700'}`}>
                                                        {svc}
                                                    </span>
                                                    {isSel && (
                                                        <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/30 flex items-center justify-center">
                                                            <i className="fa-solid fa-check text-white text-[9px]"></i>
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Date */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <SectionHeader icon="fa-calendar-days" title="Select Date" primaryColor={primaryColor} />
                                {availableDates.length === 0 ? (
                                    <p className="text-slate-400 text-sm">No available dates.</p>
                                ) : (
                                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
                                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                        {availableDates.map(d => {
                                            const key     = toDateStr(d);
                                            const isSel   = selectedDate && toDateStr(selectedDate) === key;
                                            const isToday = toDateStr(d) === toDateStr(new Date());
                                            return (
                                                <button key={key} onClick={() => handleDateSelect(d)}
                                                    className={`flex flex-col items-center px-3.5 py-3.5 rounded-2xl border-2 shrink-0 transition-all min-w-[64px] relative
                                                        ${isSel
                                                            ? 'text-white border-transparent shadow-lg'
                                                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white hover:shadow-sm'}`}
                                                    style={isSel ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}>
                                                    {isToday && !isSel && (
                                                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                                                            TODAY
                                                        </span>
                                                    )}
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isSel ? 'text-white/80' : isToday ? 'text-blue-500' : 'text-slate-400'}`}>
                                                        {DAY_SHORT[d.getDay()]}
                                                    </span>
                                                    <span className="text-xl font-extrabold mt-0.5 leading-none">{d.getDate()}</span>
                                                    <span className={`text-[10px] mt-0.5 ${isSel ? 'text-white/70' : 'text-slate-400'}`}>
                                                        {MON_SHORT[d.getMonth()]}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Time Slots — grouped by period */}
                            {selectedDate && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                    <SectionHeader icon="fa-clock" title="Select Time" primaryColor={primaryColor} />
                                    {slotsLoading ? (
                                        <div className="flex items-center justify-center gap-2.5 py-8 text-slate-400">
                                            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                                                style={{ borderColor: primaryColor, borderTopColor: 'transparent' }}></div>
                                            <span className="text-sm">Checking availability…</span>
                                        </div>
                                    ) : availableSlots.length === 0 ? (
                                        <div className="text-center py-8">
                                            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                                                <i className="fa-solid fa-calendar-xmark text-xl text-slate-300"></i>
                                            </div>
                                            <p className="text-slate-500 text-sm font-semibold">No slots available</p>
                                            <p className="text-slate-400 text-xs mt-1">Please try a different date.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {groupSlots(availableSlots).map(group => (
                                                <div key={group.label}>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 flex items-center gap-1.5">
                                                        <i className={`fa-solid ${group.icon} text-[10px]`}></i>
                                                        {group.label}
                                                    </p>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {group.slots.map(slot => (
                                                            <button key={slot.time} onClick={() => setSelectedTime(slot.time)}
                                                                className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 transition-all
                                                                    ${selectedTime === slot.time
                                                                        ? 'text-white border-transparent shadow-md'
                                                                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
                                                                style={selectedTime === slot.time ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}>
                                                                {slot.time}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <button onClick={() => setStep(2)} disabled={!canContinue}
                                className="w-full py-4 rounded-2xl text-white font-bold text-sm tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg active:scale-[0.98]"
                                style={{ backgroundColor: primaryColor }}>
                                Continue to Details →
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 2: Contact Info + Custom Questions ── */}
                {step === 2 && (
                    <div>
                        <StepIndicator step={2} primaryColor={primaryColor} />
                        <div className="space-y-4">

                            {/* Booking summary chip */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                                        style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
                                        <i className="fa-solid fa-calendar-check text-base" style={{ color: primaryColor }}></i>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-slate-800 text-sm truncate">{selectedService}</p>
                                        <p className="text-slate-400 text-xs mt-0.5">
                                            {selectedDate && formatFullDate(selectedDate)} · {selectedTime}
                                        </p>
                                    </div>
                                    <button onClick={() => setStep(1)}
                                        className="text-xs font-bold shrink-0 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                                        style={{ color: primaryColor }}>
                                        Change
                                    </button>
                                </div>
                            </div>

                            {/* Contact info */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                                <div className="flex items-center gap-2 -mb-1">
                                    <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                                        style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
                                        <i className="fa-solid fa-user text-[10px]" style={{ color: primaryColor }}></i>
                                    </div>
                                    <h3 className="font-bold text-slate-800 text-sm">Contact Information</h3>
                                </div>

                                <FormField label="Full Name *" icon="fa-user">
                                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                                        placeholder="Enter your full name"
                                        className={inputCls}
                                        onFocus={focusStyle} onBlur={blurStyle} />
                                </FormField>

                                <FormField label="WhatsApp Number *" icon="fa-phone"
                                    hint="Include country code (e.g. 91 for India)">
                                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                                        placeholder="e.g. 919876543210"
                                        className={inputCls}
                                        onFocus={focusStyle} onBlur={blurStyle} />
                                </FormField>

                                <FormField label="Email Address" icon="fa-envelope">
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                        placeholder="your@email.com (optional)"
                                        className={inputCls}
                                        onFocus={focusStyle} onBlur={blurStyle} />
                                </FormField>

                                <FormField label="Notes" icon="fa-note-sticky">
                                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                        placeholder="Any specific requests or information?" rows={3}
                                        className={`${inputCls} resize-none`}
                                        onFocus={focusStyle} onBlur={blurStyle} />
                                </FormField>
                            </div>

                            {/* Custom questions */}
                            {(page.customQuestions || []).length > 0 && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                                    <div className="flex items-center gap-2 -mb-1">
                                        <div className="w-6 h-6 rounded-lg flex items-center justify-center"
                                            style={{ backgroundColor: hexToRgba(primaryColor, 0.1) }}>
                                            <i className="fa-solid fa-circle-question text-[10px]" style={{ color: primaryColor }}></i>
                                        </div>
                                        <h3 className="font-bold text-slate-800 text-sm">Additional Information</h3>
                                    </div>
                                    {[...page.customQuestions]
                                        .sort((a, b) => a.order - b.order)
                                        .map(q => (
                                            <CustomQuestionField
                                                key={q.id}
                                                question={q}
                                                value={customAnswers[q.id] || ''}
                                                onChange={val => setCustomAnswers(prev => ({ ...prev, [q.id]: val }))}
                                                primaryColor={primaryColor}
                                            />
                                        ))}
                                </div>
                            )}

                            {submitError && (
                                <div className="flex items-center gap-2.5 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3.5">
                                    <i className="fa-solid fa-triangle-exclamation shrink-0"></i>
                                    {submitError}
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button onClick={() => setStep(1)}
                                    className="flex-1 py-4 rounded-2xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:border-slate-300 hover:bg-white transition-all">
                                    ← Back
                                </button>
                                <button onClick={handleSubmit} disabled={submitting}
                                    className="flex-[2] py-4 rounded-2xl text-white font-bold text-sm transition-all disabled:opacity-60 shadow-lg active:scale-[0.98]"
                                    style={{ backgroundColor: primaryColor }}>
                                    {submitting
                                        ? <span className="flex items-center justify-center gap-2">
                                            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                                            Booking…
                                          </span>
                                        : 'Confirm Booking ✓'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
