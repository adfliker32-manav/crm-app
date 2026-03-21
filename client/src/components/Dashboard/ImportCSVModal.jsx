import React from 'react';
import { useCSVImport } from '../../hooks/useCSVImport';

const requiredFields = [
    { key: 'name', label: 'Lead Name *', required: true },
    { key: 'phone', label: 'Phone Number *', required: true },
    { key: 'email', label: 'Email Address', required: false },
    { key: 'source', label: 'Lead Source', required: false },
    { key: 'status', label: 'Stage/Status', required: false }
];

const ImportCSVModal = ({ isOpen, onClose, onSuccess, stages = [] }) => {
    // Consume the custom hook
    const { state, refs, actions } = useCSVImport(stages, onSuccess, onClose);
    const { file, headers, csvData, mappings, isProcessing } = state;
    const { fileInputRef } = refs;
    const { handleFileChange, updateMapping, resetState, submitImport, handleClose } = actions;

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
                            <i className="fa-solid fa-file-csv text-xl"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Import Leads (CSV)</h2>
                            <p className="text-sm text-slate-500">Bulk upload and map your lead data</p>
                        </div>
                    </div>
                    <button
                        onClick={handleClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    >
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">
                    {!file ? (
                        /* Step 1: Upload File */
                        <div 
                            className="border-2 border-dashed border-slate-200 rounded-2xl p-10 flex flex-col items-center justify-center hover:bg-slate-50 hover:border-blue-300 transition-all cursor-pointer group"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input 
                                type="file" 
                                accept=".csv" 
                                className="hidden" 
                                ref={fileInputRef}
                                onChange={handleFileChange}
                            />
                            <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                <i className="fa-solid fa-cloud-arrow-up text-2xl"></i>
                            </div>
                            <h3 className="text-lg font-bold text-slate-700 mb-1">Upload CSV File</h3>
                            <p className="text-sm text-slate-500 text-center max-w-sm mb-6">
                                Drag and drop your CSV file here, or click to browse. Ensure your file has a header row.
                            </p>
                            <button className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-sm transition-colors">
                                Select File
                            </button>
                        </div>
                    ) : (
                        /* Step 2: Map Columns */
                        <div className="animate-in slide-in-from-right-4 duration-300">
                            <div className="flex justify-between items-center mb-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div className="flex items-center gap-3">
                                    <i className="fa-solid fa-file-excel text-green-600 text-xl"></i>
                                    <div>
                                        <p className="font-semibold text-slate-700 text-sm">{file.name}</p>
                                        <p className="text-xs text-slate-500">{csvData.length} total rows detected</p>
                                    </div>
                                </div>
                                <button 
                                    onClick={resetState}
                                    className="text-xs font-semibold text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    Change File
                                </button>
                            </div>

                            <div className="mb-4">
                                <h3 className="font-bold text-slate-800 text-lg mb-1">Map Columns</h3>
                                <p className="text-sm text-slate-500 mb-4">
                                    Match the columns from your CSV to the correct fields in the CRM.
                                </p>
                            </div>

                            <div className="space-y-4">
                                {requiredFields.map(field => (
                                    <div key={field.key} className="flex flex-col sm:flex-row sm:items-center p-3 hover:bg-slate-50 rounded-xl transition-colors border border-transparent hover:border-slate-100">
                                        <div className="w-1/2 flex items-center gap-2 mb-2 sm:mb-0">
                                            <span className={`text-sm font-semibold ${field.required ? 'text-slate-800' : 'text-slate-600'}`}>
                                                {field.label}
                                            </span>
                                            {field.required && (
                                                <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-md font-bold">Required</span>
                                            )}
                                        </div>
                                        <div className="w-1/2 relative">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <i className="fa-solid fa-link text-slate-400 text-xs"></i>
                                            </div>
                                            <select
                                                value={mappings[field.key]}
                                                onChange={(e) => updateMapping(field.key, e.target.value)}
                                                className={`w-full appearance-none bg-white border ${!mappings[field.key] && field.required ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'} rounded-xl py-2 pl-9 pr-10 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500`}
                                            >
                                                <option value="">-- Ignored / Not Mapped --</option>
                                                {headers.map(header => (
                                                    <option key={header} value={header}>{header}</option>
                                                ))}
                                            </select>
                                            <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-slate-400">
                                                <i className="fa-solid fa-chevron-down text-[10px]"></i>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        className="px-5 py-2.5 text-slate-600 font-semibold hover:bg-slate-200 bg-slate-100 rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    {file && (
                        <button
                            onClick={submitImport}
                            disabled={isProcessing || !mappings.name || !mappings.phone}
                            className={`px-6 py-2.5 font-bold rounded-xl shadow-lg transition-all flex items-center gap-2 ${
                                (isProcessing || !mappings.name || !mappings.phone)
                                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/30'
                            }`}
                        >
                            {isProcessing ? (
                                <>
                                    <i className="fa-solid fa-circle-notch fa-spin"></i> Processing...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-check"></i> Import Leads
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ImportCSVModal;
