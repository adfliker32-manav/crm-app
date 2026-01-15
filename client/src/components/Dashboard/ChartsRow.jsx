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
    const doughnutOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'bottom',
                labels: { color: 'white' }
            },
        },
    };

    const lineOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
        },
        scales: {
            y: { beginAtZero: true },
        },
    };

    const barOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
        },
        scales: {
            y: { beginAtZero: true },
        },
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="dashboardCharts">
            <div className="bg-slate-800 p-4 rounded-xl shadow-lg border border-slate-700 min-h-[300px] flex flex-col">
                <h3 className="text-white text-lg font-bold mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-chart-pie text-blue-500"></i> Lead Source
                </h3>
                <div className="flex-1 relative">
                    <Doughnut data={leadSourceData} options={doughnutOptions} />
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200 min-h-[300px] flex flex-col">
                <h3 className="text-slate-800 text-lg font-bold mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-chart-line text-green-500"></i> Leads Over Time
                </h3>
                <div className="flex-1 relative">
                    <Line data={leadsOverTimeData} options={lineOptions} />
                </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow-lg border border-slate-200 min-h-[300px] flex flex-col">
                <h3 className="text-slate-800 text-lg font-bold mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-layer-group text-purple-500"></i> Stage Distribution
                </h3>
                <div className="flex-1 relative">
                    {stageDistributionData ? (
                        <Bar data={stageDistributionData} options={barOptions} />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400 text-sm">No data available</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChartsRow;
