/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
        { label: 'Morning',   slots: [] },
        { label: 'Afternoon', slots: [] },
        { label: 'Evening',   slots: [] },
    ];
    slots.forEach(slot => {
        const h = getHour24(slot.time);
        if (h < 12)      groups[0].slots.push(slot);
        else if (h < 17) groups[1].slots.push(slot);
        else             groups[2].slots.push(slot);
    });
    groups.forEach(g => g.slots.sort((a, b) => getHour24(a.time) - getHour24(b.time)));
    return groups.filter(g => g.slots.length > 0);
}

const INPUT_CLS = 'w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none transition-colors bg-white text-slate-800 placeholder:text-slate-400';

function CustomQuestionField({ question, value, onChange, primaryColor }) {
    const label   = `${question.question}${question.required ? ' *' : ''}`;
    const onFocus = e => { e.target.style.borderColor = primaryColor; };
    const onBlur  = e => { e.target.style.borderColor = '#e2e8f0'; };

    if (question.type === 'textarea') return (
        <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>
            <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
                placeholder="Your answer" className={`${INPUT_CLS} resize-none`}
                onFocus={onFocus} onBlur={onBlur} />
        </div>
    );
    if (question.type === 'select') return (
        <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>
            <select value={value} onChange={e => onChange(e.target.value)}
                className={INPUT_CLS} onFocus={onFocus} onBlur={onBlur}>
                <option value="">Select an option</option>
                {(question.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        </div>
    );
    return (
        <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">{label}</label>
            <input
                type={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : 'text'}
                value={value} onChange={e => onChange(e.target.value)}
                placeholder="Your answer" className={INPUT_CLS}
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
    const tintBg           = `${primaryColor}14`; // ~8% alpha tint of brand color
    const canContinue      = selectedService && selectedDate && selectedTime;

    const handleSubmit = async () => {
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
            <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-slate-200 rounded-full animate-spin"
                    style={{ borderTopColor: '#3b82f6' }}></div>
                <p className="text-sm font-medium text-slate-500 animate-pulse">Loading booking page...</p>
            </div>
        </div>
    );

    if (error) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 max-w-sm w-full text-center border border-slate-100">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
                </div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Unavailable</h2>
                <p className="text-slate-500 text-sm leading-relaxed">{error}</p>
            </div>
        </div>
    );

    const onInputFocus = e => { e.target.style.borderColor = primaryColor; e.target.style.boxShadow = `0 0 0 3px ${primaryColor}20`; };
    const onInputBlur  = e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; };

    const selectedStyle = {
        borderColor: primaryColor,
        color: '#ffffff',
        backgroundColor: primaryColor,
        boxShadow: `0 4px 14px 0 ${primaryColor}40`,
    };
    const unselectedStyle = {
        borderColor: '#e2e8f0',
        color: '#64748b',
        backgroundColor: '#ffffff',
    };
    const touchProps = { touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' };

    return (
        <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6 lg:px-8 font-sans flex items-start sm:items-center justify-center selection:bg-slate-200">
            <div className="max-w-2xl w-full mx-auto bg-white rounded-3xl shadow-2xl shadow-slate-200/60 overflow-hidden border border-slate-100 flex flex-col">
                
                {/* ── Header ── */}
                <header className="px-8 pt-14 pb-10 text-center relative overflow-hidden shrink-0" style={{ backgroundColor: tintBg }}>
                    {/* Decorative blobs */}
                    <div className="absolute -top-24 -right-24 w-56 h-56 rounded-full blur-3xl opacity-40 mix-blend-multiply" style={{ backgroundColor: primaryColor }}></div>
                    <div className="absolute -bottom-24 -left-24 w-56 h-56 rounded-full blur-3xl opacity-40 mix-blend-multiply" style={{ backgroundColor: primaryColor }}></div>
                    
                    <div className="relative z-10">
                        {page.logoUrl ? (
                            <img src={page.logoUrl} alt=""
                                className="w-20 h-20 object-contain rounded-2xl mx-auto mb-6 shadow-md border border-white/50 bg-white p-1" />
                        ) : (
                            <div className="w-16 h-16 rounded-2xl mx-auto mb-6 shadow-sm border border-slate-200 bg-white flex items-center justify-center">
                                <i className="fa-solid fa-calendar-check text-slate-300 text-2xl"></i>
                            </div>
                        )}
                        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">{page.title}</h1>
                        {page.subtitle && (
                            <p className="text-slate-600 mt-4 text-base leading-relaxed max-w-md mx-auto">{page.subtitle}</p>
                        )}
                        {page.businessName && (
                            <p className="mt-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{page.businessName}</p>
                        )}
                    </div>
                </header>

                {/* ── Steps Indicator ── */}
                {step !== 3 && (
                    <div className="px-8 py-4 border-y border-slate-100 bg-slate-50/50 flex items-center justify-center gap-6 shrink-0">
                        {[{ n: 1, label: 'Date & Time' }, { n: 2, label: 'Your Details' }].map((s, i, arr) => (
                            <React.Fragment key={s.n}>
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${step >= s.n ? 'text-white shadow-md' : 'bg-slate-200 text-slate-400'}`}
                                        style={step >= s.n ? { backgroundColor: primaryColor, shadowColor: `${primaryColor}40` } : {}}>
                                        {step > s.n ? <i className="fa-solid fa-check"></i> : s.n}
                                    </div>
                                    <span className={`text-xs font-semibold transition-colors duration-300 ${step >= s.n ? 'text-slate-800' : 'text-slate-400'}`}>
                                        {s.label}
                                    </span>
                                </div>
                                {i < arr.length - 1 && <div className="w-8 h-px bg-slate-200"></div>}
                            </React.Fragment>
                        ))}
                    </div>
                )}

                {/* ── Content ── */}
                <div className="p-8 sm:p-10 flex-1 overflow-y-auto">
                    
                    {/* ── Step 3: Success ── */}
                    {step === 3 && (
                        <div className="py-10 text-center animate-in fade-in zoom-in duration-500">
                            <div className="w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center shadow-xl"
                                style={{ backgroundColor: primaryColor, boxShadow: `0 10px 25px -5px ${primaryColor}60` }}>
                                <i className="fa-solid fa-check text-white text-3xl"></i>
                            </div>
                            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Booking Confirmed!</h2>
                            <p className="text-slate-500 text-base mt-3 max-w-sm mx-auto leading-relaxed">
                                {page.thankYouMessage
                                    ? page.thankYouMessage.replace('{{lead.name}}', name).replace('{{name}}', name)
                                    : `Thanks, ${name}. We've received your booking.`}
                            </p>

                            <div className="mt-10 text-left max-w-sm mx-auto bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4">
                                {[
                                    { icon: 'fa-briefcase', label: 'Service', val: selectedService },
                                    { icon: 'fa-calendar-day', label: 'Date', val: formatFullDate(selectedDate) },
                                    { icon: 'fa-clock', label: 'Time', val: selectedTime },
                                ].map(row => row.val && (
                                    <div key={row.label} className="flex items-start gap-4">
                                        <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                                            <i className={`fa-solid ${row.icon} text-slate-400 text-xs`}></i>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{row.label}</p>
                                            <p className="text-sm font-bold text-slate-800 mt-0.5">{row.val}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-center gap-2 mt-8 text-sm font-medium text-slate-500">
                                <i className="fa-brands fa-whatsapp text-lg" style={{ color: '#25d366' }}></i>
                                Confirmation sent to WhatsApp
                            </div>
                        </div>
                    )}

                    {/* ── Step 1: Slot Selection ── */}
                    {step === 1 && (
                        <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-300">
                            {page.description && (
                                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6">
                                    <p className="text-slate-600 text-sm leading-relaxed text-center">
                                        {page.description}
                                    </p>
                                </div>
                            )}

                            {/* Services */}
                            {(page.services || []).length > 0 && (
                                <section>
                                    <div className="flex items-center gap-2 mb-4">
                                        <i className="fa-solid fa-briefcase text-slate-400"></i>
                                        <h3 className="text-sm font-bold text-slate-800">Select Service</h3>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {page.services.map(svc => {
                                            const isSel = selectedService === svc;
                                            return (
                                                <button key={svc} type="button" onClick={() => setSelectedService(svc)}
                                                    className="px-5 py-4 rounded-xl text-sm font-semibold border transition-all duration-200 text-left hover:scale-[1.02]"
                                                    style={{ ...touchProps, ...(isSel ? selectedStyle : unselectedStyle) }}>
                                                    {svc}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </section>
                            )}

                            {/* Date */}
                            <section>
                                <div className="flex items-center gap-2 mb-4">
                                    <i className="fa-solid fa-calendar-days text-slate-400"></i>
                                    <h3 className="text-sm font-bold text-slate-800">Select Date</h3>
                                </div>
                                {availableDates.length === 0 ? (
                                    <div className="text-center py-8 bg-slate-50 rounded-2xl border border-slate-100">
                                        <p className="text-slate-400 text-sm font-medium">No dates available.</p>
                                    </div>
                                ) : (
                                    <div className="flex gap-3 overflow-x-auto pb-2 px-1 -mx-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                        {availableDates.map(d => {
                                            const key   = toDateStr(d);
                                            const isSel = selectedDate && toDateStr(selectedDate) === key;
                                            return (
                                                <button key={key} type="button" onClick={() => handleDateSelect(d)}
                                                    className="flex flex-col items-center px-4 py-3.5 rounded-2xl border shrink-0 transition-all duration-200 min-w-[72px] hover:-translate-y-1"
                                                    style={{ ...touchProps, ...(isSel ? selectedStyle : unselectedStyle) }}>
                                                    <span className="text-[11px] font-bold uppercase tracking-wider mb-1 opacity-80">{DAY_SHORT[d.getDay()]}</span>
                                                    <span className="text-2xl font-black leading-none mb-1">{d.getDate()}</span>
                                                    <span className="text-[11px] font-medium opacity-80">{MON_SHORT[d.getMonth()]}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>

                            {/* Time slots */}
                            {selectedDate && (
                                <section className="animate-in fade-in slide-in-from-top-4 duration-300">
                                    <div className="flex items-center gap-2 mb-4">
                                        <i className="fa-solid fa-clock text-slate-400"></i>
                                        <h3 className="text-sm font-bold text-slate-800">Select Time</h3>
                                    </div>
                                    
                                    {slotsLoading ? (
                                        <div className="flex items-center justify-center gap-3 py-10 bg-slate-50 rounded-2xl border border-slate-100 text-slate-400">
                                            <div className="w-5 h-5 border-2 border-slate-300 rounded-full animate-spin"
                                                style={{ borderTopColor: primaryColor }}></div>
                                            <span className="text-sm font-medium">Checking availability...</span>
                                        </div>
                                    ) : availableSlots.length === 0 ? (
                                        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-slate-100">
                                            <p className="text-slate-500 text-sm font-medium">No slots available on this day.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-6">
                                            {groupSlots(availableSlots).map(group => (
                                                <div key={group.label}>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 pl-1">
                                                        {group.label}
                                                    </p>
                                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                                        {group.slots.map(slot => {
                                                            const isSel = selectedTime === slot.time;
                                                            return (
                                                                <button key={slot.time} type="button" onClick={() => setSelectedTime(slot.time)}
                                                                    className="py-3 rounded-xl text-sm font-bold border transition-all duration-200 hover:scale-[1.03]"
                                                                    style={{ ...touchProps, ...(isSel ? selectedStyle : unselectedStyle) }}>
                                                                    {slot.time}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            )}

                            {/* Continue Button */}
                            <div className="pt-6 border-t border-slate-100">
                                <button type="button" onClick={() => setStep(2)} disabled={!canContinue}
                                    className="w-full py-4 rounded-xl text-white font-bold text-base shadow-lg transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none hover:shadow-xl hover:-translate-y-0.5"
                                    style={{ backgroundColor: primaryColor, shadowColor: `${primaryColor}60`, ...touchProps }}>
                                    {canContinue ? `Continue with ${selectedTime}` : 'Select service, date & time'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Step 2: Contact Info ── */}
                    {step === 2 && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                            
                            {/* Summary Card */}
                            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: tintBg, color: primaryColor }}>
                                        <i className="fa-solid fa-calendar-check text-xl"></i>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Appointment Summary</p>
                                        <p className="text-sm font-semibold text-slate-900">{formatFullDate(selectedDate)} at {selectedTime}</p>
                                        {selectedService && <p className="text-xs text-slate-500 font-medium mt-0.5">{selectedService}</p>}
                                    </div>
                                </div>
                                <button type="button" onClick={() => setStep(1)}
                                    className="text-xs font-bold text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2 shrink-0 shadow-sm transition-colors"
                                    style={touchProps}>
                                    Edit
                                </button>
                            </div>

                            <section className="space-y-5">
                                <div className="flex items-center gap-2 mb-2">
                                    <i className="fa-solid fa-user text-slate-400"></i>
                                    <h3 className="text-sm font-bold text-slate-800">Your Details</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full name *</label>
                                        <input type="text" value={name} onChange={e => setName(e.target.value)}
                                            placeholder="John Doe" className={`${INPUT_CLS} shadow-sm`}
                                            onFocus={onInputFocus} onBlur={onInputBlur} />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">WhatsApp number *</label>
                                        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                                            placeholder="+1 234 567 8900" className={`${INPUT_CLS} shadow-sm`}
                                            onFocus={onInputFocus} onBlur={onInputBlur} />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            Email <span className="font-medium normal-case opacity-70">(optional)</span>
                                        </label>
                                        <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                            placeholder="john@example.com" className={`${INPUT_CLS} shadow-sm`}
                                            onFocus={onInputFocus} onBlur={onInputBlur} />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                            Notes <span className="font-medium normal-case opacity-70">(optional)</span>
                                        </label>
                                        <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                            placeholder="Any special requests or details?" rows={3}
                                            className={`${INPUT_CLS} shadow-sm resize-none`}
                                            onFocus={onInputFocus} onBlur={onInputBlur} />
                                    </div>
                                </div>
                            </section>

                            {(page.customQuestions || []).length > 0 && (
                                <section className="space-y-5">
                                    <div className="flex items-center gap-2 mb-2">
                                        <i className="fa-solid fa-clipboard-list text-slate-400"></i>
                                        <h3 className="text-sm font-bold text-slate-800">Additional Information</h3>
                                    </div>
                                    <div className="grid grid-cols-1 gap-5">
                                        {[...page.customQuestions].sort((a, b) => a.order - b.order).map(q => (
                                            <CustomQuestionField
                                                key={q.id} question={q}
                                                value={customAnswers[q.id] || ''}
                                                onChange={val => setCustomAnswers(prev => ({ ...prev, [q.id]: val }))}
                                                primaryColor={primaryColor} />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {submitError && (
                                <div className="flex items-center gap-3 text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl p-4 animate-in shake">
                                    <i className="fa-solid fa-triangle-exclamation text-lg shrink-0"></i>
                                    {submitError}
                                </div>
                            )}

                            <div className="pt-6 border-t border-slate-100 flex gap-4">
                                <button type="button" onClick={() => setStep(1)}
                                    className="px-6 py-4 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all focus:outline-none"
                                    style={touchProps}>
                                    Back
                                </button>
                                <button type="button"
                                    onPointerDown={() => { if (document.activeElement) document.activeElement.blur(); }}
                                    onClick={handleSubmit}
                                    disabled={submitting}
                                    className="flex-1 py-4 rounded-xl text-white font-bold text-sm sm:text-base shadow-lg transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-3"
                                    style={{ backgroundColor: primaryColor, shadowColor: `${primaryColor}60`, ...touchProps }}>
                                    {submitting ? (
                                        <>
                                            <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                            Processing...
                                        </>
                                    ) : (
                                        'Confirm Booking'
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
