import React from 'react';
import { useNavigate } from 'react-router-dom';

// Full-screen blocking page shown when the backend returns 402 (payment_required).
// The user can only log out from here — no other actions until payment is made.
const PaymentRequired = () => {
    const navigate = useNavigate();

    // Read stashed info (set by the api interceptor) for context
    const info = (() => {
        try {
            return JSON.parse(sessionStorage.getItem('payment_required_info') || '{}');
        } catch { return {}; }
    })();

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('payment_required_info');
        navigate('/login', { replace: true });
    };

    const handleRetry = () => {
        sessionStorage.removeItem('payment_required_info');
        window.location.replace('/');
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-rose-900 p-4">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-rose-600 to-red-700 p-8 text-white text-center">
                    <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-lock text-4xl" />
                    </div>
                    <h1 className="text-3xl font-black tracking-tight">Account Access Blocked</h1>
                    <p className="text-rose-100 text-sm mt-2 font-medium">Your subscription payment is overdue</p>
                </div>

                {/* Body */}
                <div className="p-8 space-y-5">
                    <div className="bg-rose-50 border-l-4 border-rose-500 p-4 rounded-r-lg">
                        <p className="text-sm text-rose-900 leading-relaxed">
                            <span className="font-bold">Your payment was not received in time.</span> Your subscription expired
                            {info.expiredAt && (
                                <> on <span className="font-black">{new Date(info.expiredAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></>
                            )}
                            , and the 7-day grace period has now ended.
                        </p>
                    </div>

                    <div className="space-y-2 text-sm text-slate-700">
                        <p className="font-bold text-slate-900">To restore access:</p>
                        <ul className="space-y-1.5 ml-1">
                            <li className="flex items-start gap-2">
                                <i className="fa-solid fa-circle-check text-emerald-500 mt-1 text-xs" />
                                Contact your account administrator
                            </li>
                            <li className="flex items-start gap-2">
                                <i className="fa-solid fa-circle-check text-emerald-500 mt-1 text-xs" />
                                Settle the outstanding bill
                            </li>
                            <li className="flex items-start gap-2">
                                <i className="fa-solid fa-circle-check text-emerald-500 mt-1 text-xs" />
                                Access is restored instantly once payment is recorded
                            </li>
                        </ul>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 flex items-start gap-2">
                        <i className="fa-solid fa-circle-info text-slate-400 mt-0.5" />
                        <span>Your data is safe and preserved. Nothing has been deleted — only access is paused until payment is verified.</span>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button onClick={handleRetry}
                            className="flex-1 py-2.5 bg-slate-900 hover:bg-black text-white font-bold rounded-xl transition flex items-center justify-center gap-2">
                            <i className="fa-solid fa-rotate text-xs" />
                            Check Again
                        </button>
                        <button onClick={handleLogout}
                            className="flex-1 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold rounded-xl transition flex items-center justify-center gap-2">
                            <i className="fa-solid fa-sign-out-alt text-xs" />
                            Logout
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PaymentRequired;
