/* eslint-disable no-unused-vars */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

const API_BASE  = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');
const DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function getDatesInRange(availableDays, maxAdvanceDays) {
    const dates = [];
    const today = new Date(); today.setHours(0,0,0,0);
    const limit = maxAdvanceDays > 0 ? maxAdvanceDays : 30;
    for (let i = 0; i < limit; i++) {
        const d = new Date(today); d.setDate(today.getDate() + i);
        if (availableDays.includes(d.getDay())) dates.push(d);
    }
    return dates;
}

function toDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatFullDate(d) {
    return d.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

function StepIndicator({ step, primaryColor }) {
    return (
        <div className="flex items-center justify-center gap-3 py-5">
            {[1, 2].map(s => (
                <div key={s} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
                        ${step >= s ? 'text-white shadow-md' : 'bg-slate-100 text-slate-400 border-2 border-slate-200'}`}
                        style={step >= s ? { backgroundColor: primaryColor } : {}}>
                        {step > s ? <i className="fa-solid fa-check text-xs"></i> : s}
                    </div>
                    <span className={`text-xs font-medium hidden sm:block ${step === s ? 'text-slate-700' : 'text-slate-400'}`}>
                        {s === 1 ? 'Pick a slot' : 'Your details'}
                    </span>
                    {s < 2 && <div className="w-10 h-px bg-slate-200"></div>}
                </div>
            ))}
        </div>
    );
}

export default function BookingPage() {
    const { slug } = useParams();
    const [page, setPage]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');

    const [step, setStep]                       = useState(1);
    const [selectedService, setSelectedService] = useState('');
    const [selectedDate, setSelectedDate]       = useState(null);
    const [selectedTime, setSelectedTime]       = useState('');
    const [availableSlots, setAvailableSlots]   = useState([]);
    const [slotsLoading, setSlotsLoading]       = useState(false);

    const [name, setName]           = useState('');
    const [phone, setPhone]         = useState('');
    const [email, setEmail]         = useState('');
    const [notes, setNotes]         = useState('');
    const [submitting, setSubmitting]   = useState(false);
    const [submitError, setSubmitError] = useState('');

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

    const primaryColor = page?.primaryColor || '#3b82f6';
    const canContinue  = selectedService && selectedDate && selectedTime;

    const handleSubmit = async () => {
        if (!name.trim() || !phone.trim()) { setSubmitError('Name and phone number are required.'); return; }
        setSubmitting(true); setSubmitError('');
        try {
            await axios.post(`${API_BASE}/book/${slug}/submit`, {
                customerName:    name,
                customerPhone:   phone,
                customerEmail:   email,
                serviceType:     selectedService,
                appointmentDate: toDateStr(selectedDate),
                appointmentTime: selectedTime,
                notes
            });
            setStep(3);
        } catch (err) {
            setSubmitError(err.response?.data?.message || 'Something went wrong. Please try again.');
        } finally { setSubmitting(false); }
    };

    if (loading) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="text-center">
                <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto mb-3"
                    style={{ borderColor: `#3b82f6`, borderTopColor: 'transparent' }}></div>
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

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="text-white px-4 pt-10 pb-12 text-center relative overflow-hidden" style={{ backgroundColor: primaryColor }}>
                <div className="absolute inset-0 opacity-10"
                    style={{ background: 'radial-gradient(circle at 70% 50%, white 0%, transparent 60%)' }}></div>
                <div className="relative">
                    {page.logoUrl && (
                        <img src={page.logoUrl} alt="logo"
                            className="w-16 h-16 object-contain rounded-2xl mx-auto mb-4 bg-white/20 p-2 backdrop-blur-sm shadow-lg" />
                    )}
                    {!page.logoUrl && (
                        <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
                            <i className="fa-solid fa-calendar-check text-xl"></i>
                        </div>
                    )}
                    <h1 className="text-2xl font-bold tracking-tight">{page.title}</h1>
                    <p className="text-white/75 mt-1.5 text-sm">{page.subtitle}</p>
                    {page.businessName && (
                        <div className="inline-flex items-center gap-1.5 mt-3 bg-white/15 rounded-full px-3 py-1 text-xs font-medium">
                            <i className="fa-solid fa-building text-[10px]"></i>
                            {page.businessName}
                        </div>
                    )}
                </div>
            </div>

            <div className="max-w-lg mx-auto px-4 -mt-4 pb-12">

                {/* Step 3: Success */}
                {step === 3 && (
                    <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center">
                        <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg"
                            style={{ backgroundColor: primaryColor }}>
                            <i className="fa-solid fa-check text-white text-3xl"></i>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">Booking Confirmed!</h2>
                        <p className="text-slate-500 text-sm mb-5">
                            Hi <strong>{name}</strong>, your appointment has been scheduled.
                        </p>

                        <div className="bg-slate-50 rounded-2xl p-5 text-left space-y-3 mb-6">
                            <SummaryRow icon="fa-briefcase" label="Service"  value={selectedService} />
                            <SummaryRow icon="fa-calendar" label="Date"     value={formatFullDate(selectedDate)} />
                            <SummaryRow icon="fa-clock"    label="Time"     value={selectedTime} />
                        </div>

                        <div className="flex items-center gap-2 justify-center text-sm text-green-600 font-medium">
                            <i className="fa-brands fa-whatsapp text-base"></i>
                            Confirmation sent to your WhatsApp
                        </div>
                    </div>
                )}

                {/* Step 1 */}
                {step === 1 && (
                    <div>
                        <StepIndicator step={1} primaryColor={primaryColor} />
                        <div className="space-y-4">

                            {/* Services */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Select Service</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {(page.services || []).map(svc => (
                                        <button key={svc} onClick={() => setSelectedService(svc)}
                                            className={`group py-3.5 px-3 rounded-xl text-sm font-semibold border-2 transition-all text-left flex items-center gap-2
                                                ${selectedService === svc
                                                    ? 'text-white border-transparent shadow-md'
                                                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-opacity-60 hover:bg-white'}`}
                                            style={selectedService === svc ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}>
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0
                                                ${selectedService === svc ? 'bg-white/20' : 'bg-slate-200 group-hover:bg-slate-300'}`}
                                                style={selectedService === svc ? {} : {}}>
                                                <i className="fa-solid fa-check text-[10px]"
                                                    style={selectedService === svc ? { color: primaryColor } : { color: '#94a3b8' }}></i>
                                            </div>
                                            <span className="leading-tight">{svc}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Date - horizontal chip scroller */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Select Date</h3>
                                {availableDates.length === 0 ? (
                                    <p className="text-slate-400 text-sm">No available dates.</p>
                                ) : (
                                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1"
                                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                        {availableDates.map(d => {
                                            const key = toDateStr(d);
                                            const isSelected = selectedDate && toDateStr(selectedDate) === key;
                                            const isToday = toDateStr(d) === toDateStr(new Date());
                                            return (
                                                <button key={key}
                                                    onClick={() => handleDateSelect(d)}
                                                    className={`flex flex-col items-center px-3.5 py-3 rounded-2xl border-2 shrink-0 transition-all min-w-[64px]
                                                        ${isSelected
                                                            ? 'text-white border-transparent shadow-md'
                                                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
                                                    style={isSelected ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}>
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider
                                                        ${isSelected ? 'text-white/80' : isToday ? 'text-blue-500' : 'text-slate-400'}`}>
                                                        {isToday ? 'Today' : DAY_SHORT[d.getDay()]}
                                                    </span>
                                                    <span className="text-xl font-bold mt-0.5 leading-none">{d.getDate()}</span>
                                                    <span className={`text-[10px] mt-0.5 ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                                                        {MON_SHORT[d.getMonth()]}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Time */}
                            {selectedDate && (
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Select Time</h3>
                                    {slotsLoading ? (
                                        <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                                            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                                                style={{ borderColor: primaryColor, borderTopColor: 'transparent' }}></div>
                                            <span className="text-sm">Checking availability…</span>
                                        </div>
                                    ) : availableSlots.length === 0 ? (
                                        <div className="text-center py-6">
                                            <i className="fa-solid fa-calendar-xmark text-2xl text-slate-300 mb-2 block"></i>
                                            <p className="text-slate-400 text-sm">No slots available for this date.</p>
                                            <p className="text-slate-300 text-xs mt-1">Please pick another date.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-2">
                                            {availableSlots.map(slot => (
                                                <button key={slot.time}
                                                    onClick={() => setSelectedTime(slot.time)}
                                                    className={`py-2.5 px-2 rounded-xl text-xs font-bold border-2 transition-all
                                                        ${selectedTime === slot.time
                                                            ? 'text-white border-transparent shadow-sm'
                                                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
                                                    style={selectedTime === slot.time ? { backgroundColor: primaryColor, borderColor: primaryColor } : {}}>
                                                    {slot.time}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <button onClick={() => setStep(2)} disabled={!canContinue}
                                className="w-full py-4 rounded-2xl text-white font-bold text-sm tracking-wide transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-lg"
                                style={{ backgroundColor: primaryColor }}>
                                Continue →
                            </button>
                        </div>
                    </div>
                )}

                {/* Step 2: Contact Info */}
                {step === 2 && (
                    <div>
                        <StepIndicator step={2} primaryColor={primaryColor} />
                        <div className="space-y-4">

                            {/* Summary */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-base"
                                        style={{ backgroundColor: primaryColor }}>
                                        <i className="fa-solid fa-calendar-check text-white"></i>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-slate-800 text-sm truncate">{selectedService}</p>
                                        <p className="text-slate-400 text-xs mt-0.5">
                                            {selectedDate && formatFullDate(selectedDate)} · {selectedTime}
                                        </p>
                                    </div>
                                    <button onClick={() => setStep(1)} className="text-xs font-semibold shrink-0"
                                        style={{ color: primaryColor }}>
                                        Change
                                    </button>
                                </div>
                            </div>

                            {/* Form */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
                                <h3 className="font-bold text-slate-700">Your Details</h3>

                                <FormField label="Full Name *" icon="fa-user">
                                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                                        placeholder="Enter your full name"
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                                        style={{ '--tw-ring-color': primaryColor }}
                                        onFocus={e => e.target.style.borderColor = primaryColor}
                                        onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                                </FormField>

                                <FormField label="WhatsApp Number *" icon="fa-phone">
                                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                                        placeholder="e.g. 919876543210"
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                                        onFocus={e => e.target.style.borderColor = primaryColor}
                                        onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                                </FormField>

                                <FormField label="Email Address" icon="fa-envelope">
                                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                                        placeholder="your@email.com (optional)"
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent"
                                        onFocus={e => e.target.style.borderColor = primaryColor}
                                        onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                                </FormField>

                                <FormField label="Notes" icon="fa-note-sticky">
                                    <textarea value={notes} onChange={e => setNotes(e.target.value)}
                                        placeholder="Any specific requests or information?" rows={3}
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:border-transparent resize-none"
                                        onFocus={e => e.target.style.borderColor = primaryColor}
                                        onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                                </FormField>

                                {submitError && (
                                    <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 rounded-xl p-3">
                                        <i className="fa-solid fa-triangle-exclamation"></i>
                                        {submitError}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setStep(1)}
                                    className="flex-1 py-4 rounded-2xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:border-slate-300 hover:bg-slate-50 transition-all">
                                    ← Back
                                </button>
                                <button onClick={handleSubmit} disabled={submitting}
                                    className="flex-[2] py-4 rounded-2xl text-white font-bold text-sm transition-all disabled:opacity-60 shadow-lg"
                                    style={{ backgroundColor: primaryColor }}>
                                    {submitting
                                        ? <span className="flex items-center justify-center gap-2">
                                            <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></span>
                                            Booking…
                                          </span>
                                        : 'Confirm Booking'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function FormField({ label, icon, children }) {
    return (
        <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1.5">
                <i className={`fa-solid ${icon} text-[10px]`}></i>
                {label}
            </label>
            {children}
        </div>
    );
}

function SummaryRow({ icon, label, value }) {
    return (
        <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                <i className={`fa-solid ${icon} text-slate-400 text-[11px]`}></i>
            </div>
            <div>
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-sm font-semibold text-slate-700 mt-0.5">{value}</p>
            </div>
        </div>
    );
}
