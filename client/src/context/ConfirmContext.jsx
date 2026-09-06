import React, { createContext, useContext, useState, useCallback } from 'react';

const ConfirmContext = createContext(null);

export const ConfirmProvider = ({ children }) => {
    const [confirmState, setConfirmState] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning',
        confirmText: 'Confirm',
        onConfirm: null,
        onCancel: null
    });

    // Accepts EITHER the positional form showConfirm(message, title, type) or a
    // single options object { message, title, type, confirmText }.
    //
    // ⚠️ The object form is not sugar — it is a guard. ConfirmDialog renders
    // `message` straight into JSX, so an options object arriving in that slot made
    // React throw "Objects are not valid as a React child", which the ErrorBoundary
    // turned into a full-page "Something went wrong". The promise below never
    // resolved either, so the action being confirmed silently never ran.
    const showConfirm = useCallback((messageOrOptions, title = 'Confirm Action', type = 'warning') => {
        const isOptions = messageOrOptions
            && typeof messageOrOptions === 'object'
            && !React.isValidElement(messageOrOptions);
        const opts = isOptions ? messageOrOptions : { message: messageOrOptions };

        return new Promise((resolve) => {
            setConfirmState({
                isOpen: true,
                title: opts.title ?? title,
                message: opts.message ?? '',
                type: opts.type ?? type,
                confirmText: opts.confirmText || 'Confirm',
                onConfirm: () => {
                    setConfirmState(prev => ({ ...prev, isOpen: false }));
                    resolve(true);
                },
                onCancel: () => {
                    setConfirmState(prev => ({ ...prev, isOpen: false }));
                    resolve(false);
                }
            });
        });
    }, []);

    const showDanger = useCallback((message, title = 'Confirm Delete') => {
        return showConfirm(message, title, 'danger');
    }, [showConfirm]);

    const showWarning = useCallback((message, title = 'Confirm Action') => {
        return showConfirm(message, title, 'warning');
    }, [showConfirm]);

    const showInfo = useCallback((message, title = 'Confirm') => {
        return showConfirm(message, title, 'info');
    }, [showConfirm]);

    return (
        <ConfirmContext.Provider value={{
            showConfirm,
            showDanger,
            showWarning,
            showInfo,
            confirmState
        }}>
            {children}
        </ConfirmContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useConfirm = () => {
    const context = useContext(ConfirmContext);
    if (!context) {
        throw new Error('useConfirm must be used within ConfirmProvider');
    }
    return context;
};
