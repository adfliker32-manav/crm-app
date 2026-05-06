import React, { useState } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

const TermsModal = () => {
    const { updateUser } = useAuth();
    const [accepting, setAccepting] = useState(false);

    const handleAccept = async () => {
        setAccepting(true);
        try {
            await api.post('/auth/accept-terms');
            updateUser({ termsAccepted: true });
        } catch (err) {
            console.error('Failed to accept terms:', err);
            setAccepting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-5">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-teal-500 rounded-xl flex items-center justify-center shrink-0">
                            <i className="fa-solid fa-file-contract text-white text-lg"></i>
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-lg leading-tight">Terms & Conditions</h2>
                            <p className="text-slate-400 text-xs mt-0.5">Please review and accept before continuing</p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4">
                    <p className="text-slate-600 text-sm leading-relaxed">
                        Welcome to <span className="font-semibold text-slate-800">Adfliker CRM</span>. To access your dashboard
                        you must agree to our Terms & Conditions and Privacy Policy.
                    </p>

                    <div className="space-y-2">
                        <a
                            href="/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-teal-400 hover:bg-teal-50 transition group"
                        >
                            <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-teal-200 transition">
                                <i className="fa-solid fa-file-lines text-teal-600 text-sm"></i>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-slate-700">Terms & Conditions</p>
                                <p className="text-xs text-slate-400">Read our terms of service</p>
                            </div>
                            <i className="fa-solid fa-arrow-up-right-from-square text-slate-400 text-xs group-hover:text-teal-500 transition"></i>
                        </a>

                        <a
                            href="/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition group"
                        >
                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-blue-200 transition">
                                <i className="fa-solid fa-shield-halved text-blue-600 text-sm"></i>
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-slate-700">Privacy Policy</p>
                                <p className="text-xs text-slate-400">How we handle your data</p>
                            </div>
                            <i className="fa-solid fa-arrow-up-right-from-square text-slate-400 text-xs group-hover:text-blue-500 transition"></i>
                        </a>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">
                        By clicking <span className="font-semibold">I Accept</span>, you confirm that you have read and agree
                        to our Terms & Conditions and Privacy Policy.
                    </p>
                </div>

                {/* Footer */}
                <div className="px-6 pb-6">
                    <button
                        onClick={handleAccept}
                        disabled={accepting}
                        className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-teal-200 flex items-center justify-center gap-2"
                    >
                        {accepting ? (
                            <>
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                </svg>
                                Saving...
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-check"></i>
                                I Accept — Continue to Dashboard
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TermsModal;
