import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function NotFound() {
    const { user } = useAuth();
    const backTo = user ? '/dashboard' : '/login';

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
                <p className="text-xs font-black text-slate-400 tracking-[0.3em]">404</p>
                <h1 className="text-2xl font-black text-slate-900 mt-3">Page not found</h1>
                <p className="text-sm text-slate-500 mt-2">
                    The link may be incorrect or expired.
                </p>

                <div className="mt-7 flex gap-3">
                    <Link
                        to={backTo}
                        className="flex-1 inline-flex items-center justify-center rounded-xl bg-black text-white font-bold py-3 hover:bg-slate-800 transition-colors"
                    >
                        Go back
                    </Link>
                    <Link
                        to="/"
                        className="flex-1 inline-flex items-center justify-center rounded-xl border border-slate-200 text-slate-700 font-bold py-3 hover:bg-slate-50 transition-colors"
                    >
                        Home
                    </Link>
                </div>
            </div>
        </div>
    );
}

