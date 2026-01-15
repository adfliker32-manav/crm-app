import React, { useEffect, useState } from 'react';
import { useNotification } from '../context/NotificationContext';

const NotificationContainer = () => {
    const { notifications, removeNotification } = useNotification();

    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 max-w-md pointer-events-none">
            {notifications.map(notification => (
                <Toast
                    key={notification.id}
                    notification={notification}
                    onClose={() => removeNotification(notification.id)}
                />
            ))}
        </div>
    );
};

const Toast = ({ notification, onClose }) => {
    const [isExiting, setIsExiting] = useState(false);
    const { message, type } = notification;

    useEffect(() => {
        // Trigger exit animation before removal
        const exitTimer = setTimeout(() => {
            setIsExiting(true);
        }, notification.duration - 300);

        return () => clearTimeout(exitTimer);
    }, [notification.duration]);

    const icons = {
        success: <i className="fa-solid fa-check-circle"></i>,
        error: <i className="fa-solid fa-exclamation-circle"></i>,
        warning: <i className="fa-solid fa-exclamation-triangle"></i>,
        info: <i className="fa-solid fa-info-circle"></i>
    };

    const colors = {
        success: 'bg-gradient-to-r from-green-500 to-green-600 text-white',
        error: 'bg-gradient-to-r from-red-500 to-red-600 text-white',
        warning: 'bg-gradient-to-r from-yellow-500 to-yellow-600 text-white',
        info: 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
    };

    return (
        <div
            className={`
                flex items-center gap-3 px-4 py-3 rounded-lg shadow-2xl 
                pointer-events-auto transform transition-all duration-300
                ${colors[type] || colors.info}
                ${isExiting
                    ? 'translate-x-[120%] opacity-0'
                    : 'translate-x-0 opacity-100 animate-slide-in-right'
                }
            `}
        >
            <div className="text-2xl flex-shrink-0">
                {icons[type] || icons.info}
            </div>
            <div className="flex-1">
                <p className="font-medium text-sm leading-relaxed">{message}</p>
            </div>
            <button
                onClick={onClose}
                className="text-white/80 hover:text-white ml-2 flex-shrink-0 transition"
            >
                <i className="fa-solid fa-times text-sm"></i>
            </button>
        </div>
    );
};

export default NotificationContainer;
