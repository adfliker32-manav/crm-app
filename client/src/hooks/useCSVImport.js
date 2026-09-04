import { useState, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { autoMapColumn, transformLeadRow, customMappingKey } from '../utils/csvHelpers';

const CORE_MAPPINGS = { name: '', phone: '', email: '', source: '', status: '', tags: '' };

export const useCSVImport = (stages = [], onSuccess, onClose) => {
    const { showSuccess, showError } = useNotification();

    // State
    const [file, setFile] = useState(null);
    const [headers, setHeaders] = useState([]);
    const [csvData, setCsvData] = useState([]);
    const [customFields, setCustomFields] = useState([]);
    const [mappings, setMappings] = useState({ ...CORE_MAPPINGS });
    const [isProcessing, setIsProcessing] = useState(false);
    // Quiet import suppresses the welcome email/WhatsApp for migrated contacts.
    // Defaults to OFF so a genuine new-lead import keeps behaving normally —
    // the user opts in to silence, it is never silently chosen for them.
    const [quietImport, setQuietImport] = useState(false);

    const fileInputRef = useRef(null);

    // Custom field definitions drive the extra mapping rows. Loaded once —
    // parseCSV reads them from the ref so a slow fetch can't lose an auto-map.
    const customFieldsRef = useRef([]);
    useEffect(() => {
        api.get('/custom-fields')
            .then(res => {
                const defs = res.data || [];
                customFieldsRef.current = defs;
                setCustomFields(defs);
            })
            .catch(() => { customFieldsRef.current = []; });
    }, []);

    const emptyMappings = () => {
        const base = { ...CORE_MAPPINGS };
        customFieldsRef.current.forEach(f => { base[customMappingKey(f.key)] = ''; });
        return base;
    };

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
                    const autoMap = emptyMappings();
                    results.meta.fields.forEach(header => {
                        const matchedField = autoMapColumn(header, autoMap);
                        if (matchedField) {
                            autoMap[matchedField] = header;
                        }
                    });

                    // A column header matching a custom field's label (or key)
                    // maps itself, the same convention Sheet sync already uses.
                    customFieldsRef.current.forEach(field => {
                        const match = results.meta.fields.find(h => {
                            const normalized = h.toLowerCase().trim();
                            return normalized === field.label.toLowerCase().trim()
                                || normalized === field.key.toLowerCase();
                        });
                        if (match) autoMap[customMappingKey(field.key)] = match;
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
        setMappings(emptyMappings());
        // Quiet mode is deliberately reset too: it is a per-import decision, so
        // it must never carry over silently into the next import.
        setQuietImport(false);
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
                .map(row => transformLeadRow(row, mappings, stages, customFieldsRef.current))
                .filter(lead => lead.phone !== ''); // filter out entirely blank rows Without phones

            if (leadsToImport.length === 0) {
                setIsProcessing(false);
                return showError("No valid leads found with phone numbers to import.");
            }

            // Send to Backend
            const response = await api.post('/leads/bulk-import', { leads: leadsToImport, quiet: quietImport });

            showSuccess(
                `Successfully imported ${response.data.importedCount} leads!` +
                (response.data.quiet ? ' (no welcome messages sent)' : '')
            );

            if (response.data.duplicateCount > 0) {
                showError(`${response.data.duplicateCount} duplicates were skipped.`);
            }

            // Values that matched no option on a dropdown/multi-select field.
            // They WERE imported — this is a nudge to tidy the option list.
            const unmapped = response.data.unmappedCustomValues || [];
            if (unmapped.length > 0) {
                const sample = unmapped.slice(0, 3).map(u => u.value).join('; ');
                showError(
                    `${unmapped.length} value(s) didn't match your dropdown options and were imported as-is: ${sample}` +
                    `${unmapped.length > 3 ? '…' : ''}`
                );
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
        state: { file, headers, csvData, mappings, isProcessing, customFields, quietImport },
        refs: { fileInputRef },
        actions: { handleFileChange, updateMapping, resetState, submitImport, handleClose, setQuietImport }
    };
};
