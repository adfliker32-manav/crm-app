import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const DataDeletionStatus = () => {
    const [searchParams] = useSearchParams();
    const code = searchParams.get('code');

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="max-w-lg w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
                    <i className="fa-solid fa-check text-green-600 text-2xl"></i>
                </div>

                <h1 className="text-2xl font-bold text-slate-800 mb-3">Data Deletion Processed</h1>
                <p className="text-slate-600 leading-relaxed mb-6">
                    Your request to delete your Facebook-linked data from <strong>Adfliker CRM</strong> has been
                    received and processed. All associated Meta/Facebook data has been removed from our systems.
                </p>

                {code && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-left">
                        <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">
                            Confirmation Code
                        </p>
                        <p className="font-mono text-sm text-slate-700 break-all">{code}</p>
                        <p className="text-xs text-slate-400 mt-2">
                            Keep this code for your records. It confirms your deletion request was processed.
                        </p>
                    </div>
                )}

                <div className="text-sm text-slate-500 space-y-2 mb-8 text-left bg-slate-50 rounded-xl p-4">
                    <p className="font-semibold text-slate-700 mb-2">What was deleted:</p>
                    <ul className="space-y-1 list-disc pl-4">
                        <li>Facebook OAuth access tokens</li>
                        <li>Facebook page access tokens</li>
                        <li>Facebook User ID and Page associations</li>
                        <li>Lead sync configuration linked to your Facebook account</li>
                    </ul>
                    <p className="mt-3 text-xs text-slate-400">
                        Lead records already imported into the CRM are retained as business data per our{' '}
                        <Link to="/privacy" className="text-blue-500 hover:underline">Privacy Policy</Link>.
                        To request full account deletion, contact{' '}
                        <a href="mailto:adfliker32@gmail.com" className="text-blue-500 hover:underline">
                            adfliker32@gmail.com
                        </a>.
                    </p>
                </div>

                <Link
                    to="/privacy"
                    className="text-sm text-slate-500 hover:text-slate-700 hover:underline"
                >
                    View Privacy Policy
                </Link>
            </div>
        </div>
    );
};

export default DataDeletionStatus;
