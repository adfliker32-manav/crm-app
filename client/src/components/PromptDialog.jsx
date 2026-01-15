import React, { useState, useEffect, useRef } from 'react';
import { usePrompt } from '../context/PromptContext';

const PromptDialog = () => {
    const { promptState } = usePrompt();
    const inputRef = useRef(null);

    // Use defaultValue from promptState directly as initial/controlled value
    // This avoids setState in useEffect
    const [inputValue, setInputValue] = useState(promptState.defaultValue || '');

    // Reset input when dialog opens with new default value
    const lastDefaultValueRef = useRef(promptState.defaultValue);
    if (promptState.isOpen && lastDefaultValueRef.current !== promptState.defaultValue) {
        lastDefaultValueRef.current = promptState.defaultValue;
    }

    useEffect(() => {
        if (promptState.isOpen) {
            // Reset to default value and focus
            setInputValue(promptState.defaultValue || '');
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            }, 100);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [promptState.isOpen]); // Only trigger on open state change

    if (!promptState.isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        if (promptState.onConfirm) {
            promptState.onConfirm(inputValue);
        }
    };

    const handleCancel = () => {
        if (promptState.onCancel) {
            promptState.onCancel();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200] animate-fade-in focus:outline-none">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md animate-scale-in">
                <h3 className="text-xl font-bold text-gray-800 mb-2">{promptState.title}</h3>
                <p className="text-gray-600 mb-4 text-sm">{promptState.message}</p>

                <form onSubmit={handleSubmit}>
                    <input
                        ref={inputRef}
                        type={promptState.type || 'text'}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={promptState.placeholder}
                        className="w-full px-4 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none mb-6"
                    />

                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md"
                        >
                            OK
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PromptDialog;
