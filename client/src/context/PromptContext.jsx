import React, { createContext, useContext, useState, useCallback } from 'react';

const PromptContext = createContext(null);

export const PromptProvider = ({ children }) => {
    const [promptState, setPromptState] = useState({
        isOpen: false,
        title: '',
        message: '',
        defaultValue: '',
        placeholder: '',
        type: 'text',
        onConfirm: null, // Resolves with string
        onCancel: null   // Resolves with null
    });

    const showPrompt = useCallback((message, title = 'Enter Value', defaultValue = '', placeholder = '', type = 'text') => {
        return new Promise((resolve) => {
            setPromptState({
                isOpen: true,
                title,
                message,
                defaultValue,
                placeholder,
                type,
                onConfirm: (value) => {
                    setPromptState(prev => ({ ...prev, isOpen: false }));
                    resolve(value);
                },
                onCancel: () => {
                    setPromptState(prev => ({ ...prev, isOpen: false }));
                    resolve(null);
                }
            });
        });
    }, []);

    return (
        <PromptContext.Provider value={{ showPrompt, promptState }}>
            {children}
        </PromptContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const usePrompt = () => {
    const context = useContext(PromptContext);
    if (!context) {
        throw new Error('usePrompt must be used within PromptProvider');
    }
    return context;
};
