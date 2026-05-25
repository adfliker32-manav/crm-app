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
        <div className="min-h-screen bg-white flex items-center justify-center">
            <div className="w-8 h-8 border-2 rounded-full animate-spin"
                style={{ borderColor: '#e2e8f0', borderTopColor: primaryColor }}></div>
        </div>
    );

    if (error) return (
        <div className="min-h-screen bg-white flex items-center justify-center px-4">
            <div className="text-center">
                <h2 className="text-lg font-semibold text-slate-800 mb-1">Page not found</h2>
                <p className="text-slate-500 text-sm">{error}</p>
            </div>
        </div>
    );

    const onInputFocus = e => { e.target.style.borderColor = primaryColor; };
    const onInputBlur  = e => { e.target.style.borderColor = '#e2e8f0'; };

    const selectedStyle = {
        borderColor: primaryColor,
        color: primaryColor,
        backgroundColor: tintBg,
    };
    const unselectedStyle = {
        borderColor: '#e2e8f0',
        color: '#475569',
        backgroundColor: '#ffffff',
    };
    const touchProps = { touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' };

    return (
        <div className="min-h-screen bg-white">

            {/* Thin brand accent strip */}
            <div className="h-1 w-full" style={{ backgroundColor: primaryColor }} />

            {/* Header — centered, restrained */}
            <header className="px-5 pt-10 pb-6 text-center max-w-lg mx-auto">
                {page.logoUrl && (
                    <img src={page.logoUrl} alt=""
                        className="w-14 h-14 object-contain rounded-2xl mx-auto mb-4 border border-slate-100 p-1.5 bg-white" />
                )}
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{page.title}</h1>
                {page.subtitle && (
                    <p className="text-slate-500 mt-1.5 text-sm leading-relaxed max-w-sm mx-auto">{page.subtitle}</p>
                )}
                {page.businessName && (
                    <p className="mt-3 text-[11px] font-medium text-slate-400 uppercase tracking-widest">{page.businessName}</p>
                )}
            </header>

            {/* Step indicator (steps 1 & 2 only) */}
            {step !== 3 && (
                <div className="max-w-lg mx-auto px-5 pb-4 flex items-center justify-center gap-3">
                    {[{ n: 1, label: 'Choose slot' }, { n: 2, label: 'Your details' }].map((s, i, arr) => (
                        <React.Fragment key={s.n}>
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full transition-colors ${step >= s.n ? '' : 'bg-slate-200'}`}
                                    style={step >= s.n ? { backgroundColor: primaryColor } : {}} />
                                <span className={`text-xs font-medium transition-colors ${step >= s.n ? 'text-slate-800' : 'text-slate-400'}`}>
                                    {s.label}
                                </span>
                            </div>
                            {i < arr.length - 1 && <div className="w-6 h-px bg-slate-200"></div>}
                        </React.Fragment>
                    ))}
                </div>
            )}

            <div className={`max-w-lg mx-auto px-5 ${step === 1 ? 'pb-32' : 'pb-12'}`}>

                {/* ── Step 3: Success ── */}
                {step === 3 && (
                    <div className="pt-2 text-center">
                        <div className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center"
                            style={{ backgroundColor: primaryColor }}>
                            <i className="fa-solid fa-check text-white text-xl"></i>
                        </div>
                        <h2 className="text-xl font-bold text-slate-900">Booking confirmed</h2>
                        <p className="text-slate-500 text-sm mt-2 max-w-xs mx-auto leading-relaxed">
                            {page.thankYouMessage
                                ? page.thankYouMessage.replace('{{name}}', name)
                                : `Hi ${name}, your appointment is confirmed.`}
                        </p>

                        <div className="mt-6 text-left max-w-sm mx-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
                            {[
                                { label: 'Service', val: selectedService },
                                { label: 'Date',    val: formatFullDate(selectedDate) },
                                { label: 'Time',    val: selectedTime },
                            ].map(row => row.val && (
                                <div key={row.label} className="flex items-center justify-between px-4 py-3">
                                    <span className="text-xs text-slate-500">{row.label}</span>
                                    <span className="text-sm font-semibold text-slate-800 text-right ml-3">{row.val}</span>
                                </div>
                            ))}
                        </div>

                        <div className="flex items-center justify-center gap-2 mt-6 text-sm text-slate-500">
                            <i className="fa-brands fa-whatsapp" style={{ color: '#25d366' }}></i>
                            Confirmation sent to WhatsApp
                        </div>
                    </div>
                )}

                {/* ── Step 1: Slot Selection ── */}
                {step === 1 && (
                    <div className="space-y-7">

                        {page.description && (
                            <p className="text-slate-600 text-sm leading-relaxed text-center max-w-md mx-auto">
                                {page.description}
                            </p>
                        )}

                        {/* Services */}
                        {(page.services || []).length > 0 && (
                            <section>
                                <p className="text-xs font-semibold text-slate-700 mb-2.5">Service</p>
                                <div className="flex flex-wrap gap-2">
                                    {page.services.map(svc => {
                                        const isSel = selectedService === svc;
                                        return (
                                            <button key={svc} type="button" onClick={() => setSelectedService(svc)}
                                                className="px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors min-h-[44px]"
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
                            <p className="text-xs font-semibold text-slate-700 mb-2.5">Date</p>
                            {availableDates.length === 0 ? (
                                <p className="text-slate-400 text-sm">No dates available.</p>
                            ) : (
                                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                    {availableDates.map(d => {
                                        const key   = toDateStr(d);
                                        const isSel = selectedDate && toDateStr(selectedDate) === key;
                                        return (
                                            <button key={key} type="button" onClick={() => handleDateSelect(d)}
                                                className="flex flex-col items-center px-3 py-2.5 rounded-lg border shrink-0 transition-colors min-w-[58px] min-h-[68px] justify-center"
                                                style={{ ...touchProps, ...(isSel ? selectedStyle : unselectedStyle) }}>
                                                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{DAY_SHORT[d.getDay()]}</span>
                                                <span className="text-lg font-bold leading-tight">{d.getDate()}</span>
                                                <span className="text-[10px] opacity-70">{MON_SHORT[d.getMonth()]}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </section>

                        {/* Time slots */}
                        {selectedDate && (
                            <section>
                                <p className="text-xs font-semibold text-slate-700 mb-2.5">Time</p>
                                {slotsLoading ? (
                                    <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                                        <div className="w-4 h-4 border-2 rounded-full animate-spin"
                                            style={{ borderColor: '#e2e8f0', borderTopColor: primaryColor }}></div>
                                        <span className="text-sm">Checking availability</span>
                                    </div>
                                ) : availableSlots.length === 0 ? (
                                    <p className="text-center text-slate-400 text-sm py-6">No slots on this day. Try another date.</p>
                                ) : (
                                    <div className="space-y-4">
                                        {groupSlots(availableSlots).map(group => (
                                            <div key={group.label}>
                                                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
                                                    {group.label}
                                                </p>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {group.slots.map(slot => {
                                                        const isSel = selectedTime === slot.time;
                                                        return (
                                                            <button key={slot.time} type="button" onClick={() => setSelectedTime(slot.time)}
                                                                className="py-2.5 rounded-lg text-sm font-medium border transition-colors min-h-[44px]"
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
                    </div>
                )}

                {/* ── Step 2: Contact Info ── */}
                {step === 2 && (
                    <div className="space-y-6">

                        {/* Booking summary */}
                        <div className="border border-slate-200 rounded-xl p-4 flex items-center justify-between">
                            <div>
                                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Your appointment</p>
                                <p className="text-sm font-semibold text-slate-900 mt-1">{formatFullDate(selectedDate)}</p>
                                <p className="text-2xl font-bold leading-tight mt-0.5" style={{ color: primaryColor }}>{selectedTime}</p>
                                {selectedService && <p className="text-xs text-slate-500 mt-1">{selectedService}</p>}
                            </div>
                            <button type="button" onClick={() => setStep(1)}
                                className="text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-2 shrink-0 hover:bg-slate-50 transition-colors"
                                style={touchProps}>
                                Change
                            </button>
                        </div>

                        {/* Contact info */}
                        <section className="space-y-4">
                            <p className="text-xs font-semibold text-slate-700">Your details</p>

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">Full name *</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)}
                                    placeholder="Enter your full name" className={INPUT_CLS}
                                    onFocus={onInputFocus} onBlur={onInputBlur} />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">WhatsApp number *</label>
                                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                                    placeholder="e.g. 919876543210" className={INPUT_CLS}
                                    onFocus={onInputFocus} onBlur={onInputBlur} />
                                <p className="text-[11px] text-slate-400 mt-1">Include country code (e.g. 91 for India)</p>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                    Email <span className="text-slate-400 font-normal">(optional)</span>
                                </label>
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                    placeholder="your@email.com" className={INPUT_CLS}
                                    onFocus={onInputFocus} onBlur={onInputBlur} />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                    Notes <span className="text-slate-400 font-normal">(optional)</span>
                                </label>
                                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                    placeholder="Anything we should know?" rows={3}
                                    className={`${INPUT_CLS} resize-none`}
                                    onFocus={onInputFocus} onBlur={onInputBlur} />
                            </div>
                        </section>

                        {(page.customQuestions || []).length > 0 && (
                            <section className="space-y-4">
                                <p className="text-xs font-semibold text-slate-700">Additional information</p>
                                {[...page.customQuestions].sort((a, b) => a.order - b.order).map(q => (
                                    <CustomQuestionField
                                        key={q.id} question={q}
                                        value={customAnswers[q.id] || ''}
                                        onChange={val => setCustomAnswers(prev => ({ ...prev, [q.id]: val }))}
                                        primaryColor={primaryColor} />
                                ))}
                            </section>
                        )}

                        {submitError && (
                            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3">
                                <i className="fa-solid fa-triangle-exclamation shrink-0"></i>
                                {submitError}
                            </div>
                        )}

                        <div className="flex gap-3 pt-1">
                            <button type="button" onClick={() => setStep(1)}
                                className="flex-1 py-3.5 rounded-xl border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50 transition-colors"
                                style={touchProps}>
                                Back
                            </button>
                            <button type="button"
                                onPointerDown={() => { if (document.activeElement) document.activeElement.blur(); }}
                                onClick={handleSubmit}
                                disabled={submitting}
                                className="flex-[2] py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-60 transition-opacity"
                                style={{ backgroundColor: primaryColor, ...touchProps }}>
                                {submitting
                                    ? <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                                        Booking
                                      </span>
                                    : 'Confirm booking'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Sticky bottom bar — step 1 only */}
            {step === 1 && (
                <div className="fixed bottom-0 inset-x-0 z-50 bg-white border-t border-slate-200 px-5"
                    style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', paddingTop: '16px' }}>
                    <div className="max-w-lg mx-auto">
                        <button type="button" onClick={() => setStep(2)} disabled={!canContinue}
                            className="w-full py-3.5 rounded-xl text-white font-semibold text-sm disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                            style={{ backgroundColor: primaryColor, ...touchProps }}>
                            {canContinue ? `Continue → ${selectedTime}` : 'Select service, date & time'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
