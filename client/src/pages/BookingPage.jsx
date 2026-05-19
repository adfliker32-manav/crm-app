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
        { label: 'Morning',   icon: 'fa-sun',      slots: [] },
        { label: 'Afternoon', icon: 'fa-cloud-sun', slots: [] },
        { label: 'Evening',   icon: 'fa-moon',      slots: [] },
    ];
    slots.forEach(slot => {
        const h = getHour24(slot.time);
        if (h < 12)      groups[0].slots.push(slot);
        else if (h < 17) groups[1].slots.push(slot);
        else             groups[2].slots.push(slot);
    });
    // Sort each group earliest first
    groups.forEach(g => g.slots.sort((a, b) => getHour24(a.time) - getHour24(b.time)));
    return groups.filter(g => g.slots.length > 0);
}

function CustomQuestionField({ question, value, onChange, primaryColor }) {
    const label    = `${question.question}${question.required ? ' *' : ''}`;
    const inputCls = 'w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors bg-white';
    const onFocus  = e => { e.target.style.borderColor = primaryColor; };
    const onBlur   = e => { e.target.style.borderColor = '#e2e8f0'; };

    if (question.type === 'textarea') return (
        <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
            <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
                placeholder="Your answer…" className={`${inputCls} resize-none`}
                onFocus={onFocus} onBlur={onBlur} />
        </div>
    );
    if (question.type === 'select') return (
        <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
            <select value={value} onChange={e => onChange(e.target.value)}
                className={inputCls} onFocus={onFocus} onBlur={onBlur}>
                <option value="">Select an option…</option>
                {(question.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        </div>
    );
    return (
        <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{label}</label>
            <input
                type={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : 'text'}
                value={value} onChange={e => onChange(e.target.value)}
                placeholder="Your answer…" className={inputCls}
                onFocus={onFocus} onBlur={onBlur} />
        </div>
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

    const [name, setName]                   = useState('');
    const [phone, setPhone]                 = useState('');
    const [email, setEmail]                 = useState('');
    const [notes, setNotes]                 = useState('');
    const [customAnswers, setCustomAnswers] = useState({});
    const [submitting, setSubmitting]       = useState(false);
    const [submitError, setSubmitError]     = useState('');

    useEffect(() => {
        axios.get(`${API_BASE}/book/${slug}`)
            .then(res  => { setPage(res.data); setLoading(false); })
            .catch(() => { setError('This booking page is not available.'); setLoading(false); });
    }, [slug]);

    const availableDates = useMemo(
        () => page ? getDatesInRange(page.availableDays || [1,2,3,4,5], page.maxAdvanceDays || 30) : [],
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
    const primaryColor     = (page?.primaryColor && page.primaryColor.trim()) ? page.primaryColor.trim() : '#3b82f6';
    const canContinue      = selectedService && selectedDate && selectedTime;

    const handleSubmit = async () => {
        // Dismiss keyboard immediately so viewport reflow doesn't displace the button
        if (document.activeElement) document.activeElement.blur();
        if (!name.trim() || !phone.trim()) { setSubmitError('Name and phone number are required.'); return; }
        for (const q of (page?.customQuestions || []).filter(q => q.required)) {
            if (!customAnswers[q.id]?.trim()) { setSubmitError(`"${q.question}" is required.`); return; }
        }
        setSubmitting(true); setSubmitError('');
        try {
            const answersArray = (page?.customQuestions || [])
                .filter(q => customAnswers[q.id])
                .map(q => ({ questionId: q.id, question: q.question, answer: customAnswers[q.id] }));
            await axios.post(`${API_BASE}/book/${slug}/submit`, {
                customerName: name, customerPhone: phone, customerEmail: email,
                serviceType: selectedService,
                appointmentDate: toDateStr(selectedDate), appointmentTime: selectedTime,
                notes, customAnswers: answersArray,
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
                <p className="text-slate-400 text-sm">Loading…</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="text-center">
                <i className="fa-solid fa-calendar-xmark text-4xl text-slate-300 mb-4 block"></i>
                <h2 className="text-lg font-bold text-slate-700 mb-1">Page Not Found</h2>
                <p className="text-slate-500 text-sm">{error}</p>
            </div>
        </div>
    );

    const inputCls = 'w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors bg-white';
    const onFocus  = e => { e.target.style.borderColor = primaryColor; };
    const onBlur   = e => { e.target.style.borderColor = '#e2e8f0'; };

    return (
        <div className="min-h-screen bg-slate-100">

            {/* ── Header ── */}
            <div style={{ backgroundColor: primaryColor }} className="px-5 pt-10 pb-10 text-white text-center">
                {page.logoUrl ? (
                    <img src={page.logoUrl} alt="logo"
                        className="w-14 h-14 object-contain rounded-2xl mx-auto mb-3 bg-white/20 p-1.5" />
                ) : (
                    <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-3">
                        <i className="fa-solid fa-calendar-check text-2xl"></i>
                    </div>
                )}
                <h1 className="text-xl font-extrabold tracking-tight">{page.title}</h1>
                {page.subtitle && <p className="text-white/75 mt-1 text-sm leading-relaxed max-w-xs mx-auto">{page.subtitle}</p>}
                {page.businessName && (
                    <p className="mt-2.5 text-xs font-semibold text-white/60 uppercase tracking-widest">{page.businessName}</p>
                )}
            </div>

            {/* ── Step indicator ── */}
            {step !== 3 && (
                <div style={{ backgroundColor: primaryColor }} className="px-4 pb-4">
                    <div className="max-w-lg mx-auto flex items-center justify-center gap-3">
                        {[{ n: 1, label: 'Choose Slot' }, { n: 2, label: 'Your Details' }].map((s, i) => (
                            <div key={s.n} className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                                        step >= s.n ? 'bg-white' : 'bg-white/20 text-white/50'
                                    }`} style={step >= s.n ? { color: primaryColor } : {}}>
                                        {step > s.n ? <i className="fa-solid fa-check text-[10px]"></i> : s.n}
                                    </div>
                                    <span className={`text-xs font-semibold ${step >= s.n ? 'text-white' : 'text-white/40'}`}>
                                        {s.label}
                                    </span>
                                </div>
                                {i === 0 && <div className="w-10 h-0.5 bg-white/25 rounded"></div>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className={`max-w-lg mx-auto px-4 pt-4 ${step === 1 ? 'pb-32' : 'pb-10'}`}>

                {/* ── Step 3: Success ── */}
                {step === 3 && (
                    <div className="pt-4">
                        <div className="bg-white rounded-2xl border border-slate-100 p-7 text-center">
                            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                                style={{ backgroundColor: primaryColor }}>
                                <i className="fa-solid fa-check text-white text-2xl"></i>
                            </div>
                            <h2 className="text-xl font-extrabold text-slate-800 mb-1">Booking Confirmed!</h2>
                            <p className="text-slate-500 text-sm leading-relaxed mb-5 max-w-xs mx-auto">
                                {page.thankYouMessage
                                    ? page.thankYouMessage.replace('{{name}}', name)
                                    : `Hi ${name}, your appointment has been confirmed. See you soon!`}
                            </p>
                            <div className="bg-slate-50 rounded-xl p-4 text-left space-y-3 border border-slate-100">
                                {[
                                    { icon: 'fa-briefcase', label: 'Service', val: selectedService },
                                    { icon: 'fa-calendar',  label: 'Date',    val: formatFullDate(selectedDate) },
                                    { icon: 'fa-clock',     label: 'Time',    val: selectedTime },
                                ].map(row => (
                                    <div key={row.label} className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                            style={{ backgroundColor: primaryColor }}>
                                            <i className={`fa-solid ${row.icon} text-white text-xs`}></i>
                                        </div>
                                        <div>
                                            <p className="text-[11px] text-slate-400">{row.label}</p>
                                            <p className="text-sm font-bold text-slate-700">{row.val}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center justify-center gap-2 mt-5 text-sm text-green-600 font-semibold">
                                <i className="fa-brands fa-whatsapp text-lg"></i>
                                Confirmation sent to WhatsApp
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Step 1: Slot Selection ── */}
                {step === 1 && (
                    <div className="space-y-3">

                        {/* Selected appointment — shown at TOP once date + time are both picked */}
                        {selectedDate && selectedTime && (
                            <div className="rounded-2xl p-4 text-white flex items-center justify-between"
                                style={{ backgroundColor: primaryColor }}>
                                <div>
                                    <p className="text-[11px] text-white/65 font-medium uppercase tracking-wider">Your Appointment</p>
                                    <p className="text-sm font-semibold mt-0.5">{formatFullDate(selectedDate)}</p>
                                    <p className="text-2xl font-extrabold leading-tight">{selectedTime}</p>
                                    {selectedService && (
                                        <p className="text-xs text-white/70 mt-0.5">{selectedService}</p>
                                    )}
                                </div>
                                <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
                                    <i className="fa-solid fa-calendar-check text-2xl text-white/90"></i>
                                </div>
                            </div>
                        )}

                        {/* Description */}
                        {page.description && (
                            <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
                                <p className="text-slate-600 text-sm leading-relaxed">{page.description}</p>
                            </div>
                        )}

                        {/* Services */}
                        {(page.services || []).length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-100 p-4">
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                                    <i className="fa-solid fa-briefcase mr-1.5"></i>Select Service
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {page.services.map(svc => {
                                        const isSel = selectedService === svc;
                                        return (
                                            <button key={svc} onClick={() => setSelectedService(svc)}
                                                className="px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all min-h-[44px]"
                                                style={isSel
                                                    ? { backgroundColor: primaryColor, borderColor: primaryColor, color: 'white' }
                                                    : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', color: '#475569' }
                                                }>
                                                {svc}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Date */}
                        <div className="bg-white rounded-2xl border border-slate-100 p-4">
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                                <i className="fa-solid fa-calendar-days mr-1.5"></i>Select Date
                            </p>
                            {availableDates.length === 0 ? (
                                <p className="text-slate-400 text-sm">No available dates.</p>
                            ) : (
                                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                    {availableDates.map(d => {
                                        const key     = toDateStr(d);
                                        const isSel   = selectedDate && toDateStr(selectedDate) === key;
                                        const isToday = toDateStr(d) === toDateStr(new Date());
                                        return (
                                            <button key={key} onClick={() => handleDateSelect(d)}
                                                className="flex flex-col items-center px-3 py-3 rounded-xl border-2 shrink-0 transition-all min-w-[58px] min-h-[78px] justify-center"
                                                style={isSel
                                                    ? { backgroundColor: primaryColor, borderColor: primaryColor, color: 'white' }
                                                    : isToday
                                                        ? { backgroundColor: '#eff6ff', borderColor: '#bfdbfe', color: '#1e40af' }
                                                        : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', color: '#475569' }
                                                }>
                                                <span className="text-[10px] font-bold uppercase tracking-wider opacity-75">{DAY_SHORT[d.getDay()]}</span>
                                                <span className="text-xl font-extrabold leading-tight">{d.getDate()}</span>
                                                <span className="text-[10px] opacity-70">{MON_SHORT[d.getMonth()]}</span>
                                                {isToday && (
                                                    <span className="text-[8px] font-extrabold uppercase mt-0.5" style={{ color: isSel ? 'rgba(255,255,255,0.8)' : primaryColor }}>
                                                        Today
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Time slots */}
                        {selectedDate && (
                            <div className="bg-white rounded-2xl border border-slate-100 p-4">
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                                    <i className="fa-solid fa-clock mr-1.5"></i>Select Time
                                </p>
                                {slotsLoading ? (
                                    <div className="flex items-center justify-center gap-2 py-8 text-slate-400">
                                        <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                                            style={{ borderColor: primaryColor, borderTopColor: 'transparent' }}></div>
                                        <span className="text-sm">Checking availability…</span>
                                    </div>
                                ) : availableSlots.length === 0 ? (
                                    <div className="text-center py-8">
                                        <i className="fa-solid fa-calendar-xmark text-3xl text-slate-200 mb-3 block"></i>
                                        <p className="text-slate-500 text-sm font-semibold">No slots available</p>
                                        <p className="text-slate-400 text-xs mt-1">Try a different date.</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {groupSlots(availableSlots).map(group => (
                                            <div key={group.label}>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                                    <i className={`fa-solid ${group.icon}`}></i>{group.label}
                                                </p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {group.slots.map(slot => {
                                                        const isSel = selectedTime === slot.time;
                                                        return (
                                                            <button key={slot.time} onClick={() => setSelectedTime(slot.time)}
                                                                className="py-3 rounded-xl text-xs font-bold border-2 transition-all min-h-[44px]"
                                                                style={isSel
                                                                    ? { backgroundColor: primaryColor, borderColor: primaryColor, color: 'white' }
                                                                    : { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', color: '#475569' }
                                                                }>
                                                                {slot.time}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Step 2: Contact Info ── */}
                {step === 2 && (
                    <div className="space-y-3">

                        {/* Booking summary at top */}
                        <div className="rounded-2xl p-4 text-white" style={{ backgroundColor: primaryColor }}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-[11px] text-white/65 font-medium uppercase tracking-wider">Your Appointment</p>
                                    <p className="text-sm font-semibold mt-0.5">{formatFullDate(selectedDate)}</p>
                                    <p className="text-2xl font-extrabold leading-tight">{selectedTime}</p>
                                    {selectedService && <p className="text-xs text-white/70 mt-0.5">{selectedService}</p>}
                                </div>
                                <button onClick={() => setStep(1)}
                                    className="text-xs font-bold bg-white/20 px-3 py-2 rounded-xl shrink-0">
                                    Change
                                </button>
                            </div>
                        </div>

                        {/* Contact info */}
                        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-4">
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                <i className="fa-solid fa-user mr-1.5"></i>Contact Information
                            </p>

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Full Name *</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)}
                                    placeholder="Enter your full name" className={inputCls}
                                    onFocus={onFocus} onBlur={onBlur} />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">WhatsApp Number *</label>
                                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                                    placeholder="e.g. 919876543210" className={inputCls}
                                    onFocus={onFocus} onBlur={onBlur} />
                                <p className="text-[11px] text-slate-400 mt-1">Include country code (e.g. 91 for India)</p>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email Address</label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                    placeholder="your@email.com (optional)" className={inputCls}
                                    onFocus={onFocus} onBlur={onBlur} />
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Notes</label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                    placeholder="Any specific requests or information?" rows={3}
                                    className={`${inputCls} resize-none`}
                                    onFocus={onFocus} onBlur={onBlur} />
                            </div>
                        </div>

                        {/* Custom questions */}
                        {(page.customQuestions || []).length > 0 && (
                            <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-4">
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                                    <i className="fa-solid fa-circle-question mr-1.5"></i>Additional Information
                                </p>
                                {[...page.customQuestions].sort((a, b) => a.order - b.order).map(q => (
                                    <CustomQuestionField
                                        key={q.id} question={q}
                                        value={customAnswers[q.id] || ''}
                                        onChange={val => setCustomAnswers(prev => ({ ...prev, [q.id]: val }))}
                                        primaryColor={primaryColor} />
                                ))}
                            </div>
                        )}

                        {submitError && (
                            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl p-3.5">
                                <i className="fa-solid fa-triangle-exclamation shrink-0"></i>
                                {submitError}
                            </div>
                        )}

                        {/* Buttons inside scroll — reliable on mobile after keyboard closes */}
                        <div className="flex gap-3 pt-1">
                            <button onClick={() => setStep(1)}
                                className="flex-1 py-4 rounded-2xl border-2 border-slate-200 text-slate-600 font-bold text-sm"
                                style={{ touchAction: 'manipulation' }}>
                                ← Back
                            </button>
                            <button
                                onPointerDown={() => { if (document.activeElement) document.activeElement.blur(); }}
                                onClick={handleSubmit}
                                disabled={submitting}
                                className="flex-[2] py-4 rounded-2xl text-white font-bold text-sm disabled:opacity-60"
                                style={{ backgroundColor: primaryColor, touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}>
                                {submitting
                                    ? <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                                        Booking…
                                      </span>
                                    : 'Confirm Booking ✓'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Sticky bottom bar — step 1 only (no inputs, safe to use fixed) ── */}
            {step === 1 && (
                <div className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-slate-200 px-4"
                    style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', paddingTop: '16px' }}>
                    <div className="max-w-lg mx-auto">
                        <button onClick={() => setStep(2)} disabled={!canContinue}
                            className="w-full py-4 rounded-2xl text-white font-bold text-sm tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
                            style={{ backgroundColor: primaryColor, touchAction: 'manipulation' }}>
                            {canContinue ? `Continue → ${selectedTime}` : 'Select Service, Date & Time'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
