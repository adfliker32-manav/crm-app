import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const ActivityTimeline = ({ leadId }) => {
    const [activities, setActivities] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchActivities = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.get(`/activity-logs/lead/${leadId}`);
            if (res.data.success) {
                setActivities(res.data.logs);
            }
        } catch (error) {
            console.error('Failed to fetch activity logs:', error);
        } finally {
            setLoading(false);
        }
    }, [leadId]);

    useEffect(() => {
        if (leadId) {
            fetchActivities();
        }
    }, [leadId, fetchActivities]);

    const getRelativeTime = (timestamp) => {
        const now = new Date();
        const activityDate = new Date(timestamp);
        const diffMs = now - activityDate;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return activityDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: activityDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    };

    const getActionIcon = (actionType) => {
        switch (actionType) {
            case 'LEAD_CREATED':
                return { icon: 'fa-plus-circle', color: 'text-green-600', bg: 'bg-green-50' };
            case 'LEAD_EDITED':
                return { icon: 'fa-pen', color: 'text-blue-600', bg: 'bg-blue-50' };
            case 'LEAD_DELETED':
                return { icon: 'fa-trash', color: 'text-red-600', bg: 'bg-red-50' };
            case 'LEAD_STATUS_CHANGED':
                return { icon: 'fa-exchange-alt', color: 'text-purple-600', bg: 'bg-purple-50' };
            case 'LEAD_ASSIGNED':
                return { icon: 'fa-user-tag', color: 'text-indigo-600', bg: 'bg-indigo-50' };
            case 'NOTE_ADDED':
                return { icon: 'fa-sticky-note', color: 'text-orange-600', bg: 'bg-orange-50' };
            case 'NOTE_DELETED':
                return { icon: 'fa-note-sticky', color: 'text-red-600', bg: 'bg-red-50' };
            case 'FOLLOWUP_CREATED':
                return { icon: 'fa-calendar-plus', color: 'text-teal-600', bg: 'bg-teal-50' };
            case 'FOLLOWUP_COMPLETED':
                return { icon: 'fa-calendar-check', color: 'text-green-600', bg: 'bg-green-50' };
            case 'EMAIL_SENT':
                return { icon: 'fa-envelope', color: 'text-blue-600', bg: 'bg-blue-50' };
            case 'WHATSAPP_SENT':
                return { icon: 'fa-brands fa-whatsapp', color: 'text-green-600', bg: 'bg-green-50' };
            default:
                return { icon: 'fa-circle', color: 'text-gray-600', bg: 'bg-gray-50' };
        }
    };

    const getActionDescription = (activity) => {
        const { actionType, changes, metadata } = activity;

        switch (actionType) {
            case 'LEAD_CREATED':
                return `created this lead`;
            case 'LEAD_EDITED':
                return `edited lead details`;
            case 'LEAD_DELETED':
                return `deleted this lead`;
            case 'LEAD_STATUS_CHANGED':
                if (changes?.status) {
                    return `changed status from "${changes.status.before}" to "${changes.status.after}"`;
                }
                return `changed lead status`;
            case 'LEAD_ASSIGNED':
                return metadata?.assignedTo === 'Unassigned'
                    ? `unassigned this lead`
                    : `assigned this lead to an agent`;
            case 'NOTE_ADDED':
                return `added a note`;
            case 'NOTE_DELETED':
                return `deleted a note`;
            case 'FOLLOWUP_CREATED':
                return `created a follow-up`;
            case 'FOLLOWUP_COMPLETED':
                return `completed a follow-up`;
            case 'EMAIL_SENT':
                return `sent an email`;
            case 'WHATSAPP_SENT':
                return `sent a WhatsApp message`;
            default:
                return `performed an action`;
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <i className="fa-solid fa-circle-notch fa-spin text-2xl text-slate-400"></i>
            </div>
        );
    }

    if (activities.length === 0) {
        return (
            <div className="text-center py-8">
                <i className="fa-solid fa-history text-4xl text-slate-200 mb-3"></i>
                <p className="text-slate-400">No activity yet</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {activities.map((activity) => {
                const iconData = getActionIcon(activity.actionType);

                return (
                    <div key={activity._id} className="flex gap-3 group">
                        {/* Icon */}
                        <div className="flex-shrink-0">
                            <div className={`w-10 h-10 rounded-full ${iconData.bg} flex items-center justify-center`}>
                                <i className={`fa-solid ${iconData.icon} ${iconData.color}`}></i>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                            <div className="bg-slate-50 rounded-lg p-3 group-hover:bg-slate-100 transition">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1">
                                        <p className="text-sm text-slate-700">
                                            <span className="font-semibold">{activity.userName}</span>{' '}
                                            {getActionDescription(activity)}
                                        </p>

                                        {/* Additional details */}
                                        {activity.metadata?.noteText && (
                                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                                                "{activity.metadata.noteText}"
                                            </p>
                                        )}
                                    </div>

                                    <span className="text-xs text-slate-400 whitespace-nowrap">
                                        {getRelativeTime(activity.timestamp)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default ActivityTimeline;
