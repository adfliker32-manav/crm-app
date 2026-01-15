import React, { createContext, useContext, useState, useCallback } from 'react';

const ConfirmContext = createContext(null);

export const ConfirmProvider = ({ children }) => {
    const [confirmState, setConfirmState] = useState({
        isOpen: false,
        title: '',
        message: '',
        type: 'warning',
        onConfirm: null,
        onCancel: null
    });

    const showConfirm = useCallback((message, title = 'Confirm Action', type = 'warning') => {
        return new Promise((resolve) => {
            setConfirmState({
                isOpen: true,
                title,
                message,
                type,
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
