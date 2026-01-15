import React from 'react';

const StatCard = ({ title, value, icon, iconColor, subtext, gradient }) => {
    return (
        <div className={`p-6 rounded-xl shadow-lg flex flex-col justify-between text-white ${gradient}`}>
            <h3 className="text-lg opacity-80 flex items-center gap-2">
                <i className={`fa-solid ${icon} ${iconColor ? iconColor : ''}`}></i> {title}
            </h3>
            <p className="text-4xl font-bold">{value}</p>
            {subtext && <p className="text-sm opacity-75 mt-2">{subtext}</p>}
        </div>
    );
};

export default StatCard;
