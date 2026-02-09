import React from 'react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
    BarElement,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    ArcElement,
    BarElement
);

const ChartsRow = ({ leadSourceData, leadsOverTimeData, stageDistributionData }) => {
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
        },
    };

    const doughnutOptions = {
        ...commonOptions,
        plugins: {
            legend: {
                position: 'bottom',
                labels: {
                    color: '#64748b',
                    font: { size: 12, weight: '500' },
                    padding: 16,
                    usePointStyle: true,
                    pointStyle: 'circle'
                }
            },
        },
        cutout: '70%',
    };

    const lineOptions = {
        ...commonOptions,
        scales: {
            y: {
                beginAtZero: true,
                grid: { color: '#f1f5f9', drawBorder: false },
                ticks: { color: '#94a3b8', font: { size: 11 } },
                border: { display: false }
            },
            x: {
                grid: { display: false },
                ticks: { color: '#94a3b8', font: { size: 11 } },
                border: { display: false }
            },
        },
    };

    const barOptions = {
        ...commonOptions,
        scales: {
            y: {
                beginAtZero: true,
                grid: { color: '#f1f5f9', drawBorder: false },
                ticks: { color: '#94a3b8', font: { size: 11 } },
                border: { display: false }
            },
            x: {
                grid: { display: false },
                ticks: { color: '#94a3b8', font: { size: 11 } },
                border: { display: false }
            },
        },
        borderRadius: 8,
        barThickness: 32,
    };

    const refinedLeadSourceData = {
        ...leadSourceData,
        datasets: [{
            ...leadSourceData.datasets[0],
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'],
            borderWidth: 0,
        }]
    };

    const refinedLeadsOverTimeData = {
        ...leadsOverTimeData,
        datasets: [{
            ...leadsOverTimeData.datasets[0],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#3b82f6',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
            borderWidth: 2,
        }]
    };

    const refinedStageData = {
        ...stageDistributionData,
        datasets: [{
            ...stageDistributionData?.datasets?.[0],
            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'],
            borderWidth: 0,
            borderRadius: 8,
        }]
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="dashboardCharts">
            <div className="bg-white rounded-xl border border-neutral-100 p-6 hover:shadow-lg hover:border-neutral-200 transition-all">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-neutral-900">Lead Source</h3>
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
                        <i className="fa-solid fa-chart-pie text-neutral-500 text-sm"></i>
                    </div>
                </div>
                <div className="h-[220px] relative">
                    <Doughnut data={refinedLeadSourceData} options={doughnutOptions} />
                </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-100 p-6 hover:shadow-lg hover:border-neutral-200 transition-all">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-neutral-900">Leads Over Time</h3>
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
                        <i className="fa-solid fa-chart-line text-neutral-500 text-sm"></i>
                    </div>
                </div>
                <div className="h-[220px] relative">
                    <Line data={refinedLeadsOverTimeData} options={lineOptions} />
                </div>
            </div>

            <div className="bg-white rounded-xl border border-neutral-100 p-6 hover:shadow-lg hover:border-neutral-200 transition-all">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-base font-semibold text-neutral-900">Pipeline Stages</h3>
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center">
                        <i className="fa-solid fa-layer-group text-neutral-500 text-sm"></i>
                    </div>
                </div>
                <div className="h-[220px] relative">
                    {stageDistributionData ? (
                        <Bar data={refinedStageData} options={barOptions} />
                    ) : (
                        <div className="flex items-center justify-center h-full text-neutral-400 text-sm">
                            No data available
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChartsRow;
