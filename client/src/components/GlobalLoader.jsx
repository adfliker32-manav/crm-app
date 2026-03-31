import React from 'react';

const GlobalLoader = () => {
    return (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-50 z-50">
            <div className="flex flex-col items-center">
                {/* Premium Animated Spinner */}
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 rounded-full border-4 border-slate-200"></div>
                    <div className="absolute inset-0 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin"></div>
                </div>
                {/* Minimalist Loading Text */}
                <span className="mt-4 text-sm font-bold tracking-[0.2em] text-slate-400 uppercase animate-pulse">
                    Loading
                </span>
            </div>
        </div>
    );
};

export default GlobalLoader;
