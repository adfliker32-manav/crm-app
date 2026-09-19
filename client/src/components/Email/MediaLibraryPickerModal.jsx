import React from 'react';
import MediaLibrary from '../WhatsApp/MediaLibrary';

/**
 * "Insert from library" for email.
 *
 * Wraps the shared Media Library — the same store WhatsApp templates,
 * broadcasts and chatbot flows pick from — so a brochure uploaded once can be
 * attached to an email without a second copy. The library's own upload zone is
 * inside, so "pick an existing file" and "upload a new one" are the same modal.
 *
 * Video is deliberately not offered: a 16 MB MP4 blows the 25 MB mail budget.
 */
const EMAIL_MEDIA_TYPES = ['DOCUMENT', 'IMAGE'];

const MediaLibraryPickerModal = ({
    isOpen,
    onClose,
    onSelect,
    title = 'Attach from Media Library',
    subtitle = 'Pick a file you already use in WhatsApp templates, or upload a new one.'
}) => {
    if (!isOpen) return null;

    return (
        // z-[60]: this opens ON TOP of the template modal, which already sits at z-50.
        <div
            className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
                    <div>
                        <h3 className="text-base font-bold text-slate-800">
                            <i className="fa-solid fa-photo-film text-emerald-600 mr-2"></i>
                            {title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
                        aria-label="Close"
                    >
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <div className="overflow-y-auto p-6 flex-1">
                    <MediaLibrary
                        pickerMode
                        allowedType={EMAIL_MEDIA_TYPES}
                        onSelect={onSelect}
                    />
                </div>
            </div>
        </div>
    );
};

export default MediaLibraryPickerModal;
export { EMAIL_MEDIA_TYPES };
