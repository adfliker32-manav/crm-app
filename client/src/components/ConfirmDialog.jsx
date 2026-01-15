import React from 'react';
import { useConfirm } from '../context/ConfirmContext';

const ConfirmDialog = () => {
    const { confirmState } = useConfirm();
    const { isOpen, title, message, type, onConfirm, onCancel } = confirmState;

    if (!isOpen) return null;

    const iconConfig = {
        warning: {
            bg: 'bg-yellow-100',
            icon: 'fa-exclamation-triangle',
            color: 'text-yellow-600',
            buttonClass: 'bg-yellow-600 hover:bg-yellow-700'
        },
        danger: {
            bg: 'bg-red-100',
            icon: 'fa-exclamation-circle',
            color: 'text-red-600',
            buttonClass: 'bg-red-600 hover:bg-red-700'
        },
        info: {
            bg: 'bg-blue-100',
            icon: 'fa-question-circle',
            color: 'text-blue-600',
            buttonClass: 'bg-blue-600 hover:bg-blue-700'
        }
    };

    const config = iconConfig[type] || iconConfig.warning;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999] animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md mx-4">
                <div className="flex items-start gap-4 mb-4">
                    <div className={`w-12 h-12 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0`}>
                        <i className={`fa-solid ${config.icon} ${config.color} text-2xl`}></i>
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-800 mb-2">{title}</h3>
                        <p className="text-sm text-gray-600 leading-relaxed">{message}</p>
                    </div>
                </div>

                <div className="flex gap-3 justify-end mt-6">
                    <button
                        onClick={onCancel}
                        className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`px-5 py-2.5 text-white rounded-lg font-medium transition ${config.buttonClass}`}
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
