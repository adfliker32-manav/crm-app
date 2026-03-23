import { useState, useRef } from 'react';
import Papa from 'papaparse';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { autoMapColumn, transformLeadRow } from '../utils/csvHelpers';

export const useCSVImport = (stages = [], onSuccess, onClose) => {
    const { showSuccess, showError } = useNotification();
    
    // State
    const [file, setFile] = useState(null);
    const [headers, setHeaders] = useState([]);
    const [csvData, setCsvData] = useState([]);
    const [mappings, setMappings] = useState({
        name: '',
        phone: '',
        email: '',
        source: '',
        status: '',
        tags: ''
    });
    const [isProcessing, setIsProcessing] = useState(false);
    
    const fileInputRef = useRef(null);

    // Parse the given File using PapaParse
    const parseCSV = (selectedFile) => {
        Papa.parse(selectedFile, {
            header: true,
            skipEmptyLines: true,
            complete: function (results) {
                if (results.meta && results.meta.fields) {
                    setHeaders(results.meta.fields);
                    setCsvData(results.data);
                    
                    // Auto-mapping heuristics
                    const autoMap = { name: '', phone: '', email: '', source: '', status: '', tags: '' };
                    results.meta.fields.forEach(header => {
                        const matchedField = autoMapColumn(header, autoMap);
                        if (matchedField) {
                            autoMap[matchedField] = header;
                        }
                    });
                    setMappings(autoMap);
                }
            },
            error: function (error) {
                showError("Failed to parse CSV file");
                console.error("PapaParse error:", error);
            }
        });
    };

    // Actions
    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            setFile(selectedFile);
            parseCSV(selectedFile);
        }
    };

    const updateMapping = (crmField, csvHeader) => {
        setMappings(prev => ({
            ...prev,
            [crmField]: csvHeader
        }));
    };

    const resetState = () => {
        setFile(null);
        setHeaders([]);
        setCsvData([]);
        setMappings({ name: '', phone: '', email: '', source: '', status: '', tags: '' });
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleClose = () => {
        resetState();
        if (onClose) onClose();
    };

    const submitImport = async () => {
        // Validation
        if (!mappings.name || !mappings.phone) {
            return showError("Please map the required fields (Name and Phone).");
        }

        setIsProcessing(true);

        try {
            const leadsToImport = csvData
                .map(row => transformLeadRow(row, mappings, stages))
                .filter(lead => lead.phone !== ''); // filter out entirely blank rows Without phones

            if (leadsToImport.length === 0) {
                setIsProcessing(false);
                return showError("No valid leads found with phone numbers to import.");
            }

            // Send to Backend
            const response = await api.post('/leads/bulk-import', { leads: leadsToImport });
            
            showSuccess(`Successfully imported ${response.data.importedCount} leads!`);
            
            if (response.data.duplicateCount > 0) {
                showError(`${response.data.duplicateCount} duplicates were skipped.`);
            }

            if (onSuccess) onSuccess();
            handleClose();
        } catch (error) {
            console.error("Bulk Import Error:", error);
            showError(error.response?.data?.message || "Failed to import leads");
        } finally {
            setIsProcessing(false);
        }
    };

    return {
        state: { file, headers, csvData, mappings, isProcessing },
        refs: { fileInputRef },
        actions: { handleFileChange, updateMapping, resetState, submitImport, handleClose }
    };
};
