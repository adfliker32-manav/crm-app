/* eslint-disable no-unused-vars */
import React from 'react';

const WALLPAPER_SVG = `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M11 18c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm48 25c3.866 0 7-3.134 7-7s-3.134-7-7-7-7 3.134-7 7 3.134 7 7 7zm-43-7c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm63 31c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zM34 90c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3zm56-76c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2z' fill='%23d4cfc4' fill-opacity='0.4' fill-rule='evenodd'/%3E%3C/svg%3E")`;

const TemplatePhonePreview = ({ headerComp, currentHeaderFormat, mediaPreview, bodyComp, footerComp, btnComp, renderPreviewText, formatFileSize, analytics }) => {
    return (
        <div className="w-[45%] border-l border-slate-200 bg-gradient-to-br from-slate-200 via-slate-100 to-white flex items-start justify-center p-10 overflow-y-auto">
            <div className="w-full max-w-[340px] sticky top-0">
                <div className="text-center mb-6">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-white rounded-full border border-slate-200 shadow-sm">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Real-time Preview</p>
                    </div>
                </div>

                {/* High-Fidelity Phone Frame */}
                <div className="bg-[#1c1c1e] rounded-[3.5rem] p-3.5 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.3)] border-4 border-[#3a3a3c] relative">
                    {/* Side Buttons */}
                    <div className="absolute -left-1.5 top-28 w-1 h-12 bg-[#2c2c2e] rounded-l-md"></div>
                    <div className="absolute -left-1.5 top-44 w-1 h-16 bg-[#2c2c2e] rounded-l-md"></div>
                    <div className="absolute -right-1.5 top-36 w-1 h-20 bg-[#2c2c2e] rounded-r-md"></div>

                    <div className="bg-white rounded-[2.8rem] overflow-hidden shadow-inner border border-black/5 relative h-[620px] flex flex-col">
                        {/* iOS Status Bar / Notch Area */}
                        <div className="bg-white h-11 flex items-center justify-between px-8 relative">
                            <div className="text-[11px] font-bold">9:41</div>
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-7 bg-black rounded-b-3xl flex items-center justify-center gap-1.5">
                                <div className="w-4 h-1 bg-[#1c1c1e] rounded-full"></div>
                                <div className="w-1.5 h-1.5 bg-[#1c1c1e] rounded-full"></div>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <i className="fa-solid fa-signal text-[10px]"></i>
                                <i className="fa-solid fa-wifi text-[10px]"></i>
                                <i className="fa-solid fa-battery-full text-[11px]"></i>
                            </div>
                        </div>

                        {/* WhatsApp Header - Real Look */}
                        <div className="bg-[#f0f2f5] border-b border-gray-200 px-4 py-3 flex items-center gap-3">
                            <i className="fa-solid fa-chevron-left text-[#007aff] text-sm"></i>
                            <div className="w-10 h-10 bg-gradient-to-br from-slate-200 to-slate-300 rounded-full flex items-center justify-center flex-shrink-0 border border-white shadow-sm overflow-hidden">
                                <i className="fa-solid fa-user text-slate-400 text-lg"></i>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-extrabold text-sm text-[#111b21] truncate">AdfliKer Customer</div>
                                <div className="text-[10px] text-green-600 font-bold flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                                    online
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-[#007aff]">
                                <i className="fa-solid fa-video"></i>
                                <i className="fa-solid fa-phone"></i>
                            </div>
                        </div>

                        {/* Chat Wallpaper - Premium Pattern */}
                        <div className="flex-1 bg-[#efeae2] p-4 flex flex-col justify-end relative overflow-hidden"
                            style={{ backgroundImage: WALLPAPER_SVG }}>

                            {/* Glassy Background Overlay */}
                            <div className="absolute inset-0 bg-white/10 backdrop-blur-[1px]"></div>

                            {/* Message Bubble - Real WhatsApp iOS Style */}
                            <div className="relative z-10 flex flex-col items-start gap-1 max-w-[90%] drop-shadow-sm">
                                <div className="bg-white rounded-[1.2rem] rounded-tl-none shadow-sm overflow-hidden w-full border border-gray-100">
                                    {/* ─── Media Header Preview ─── */}
                                    {headerComp && currentHeaderFormat === 'IMAGE' && (
                                        <div className="bg-slate-100 h-44 flex items-center justify-center relative overflow-hidden">
                                            {mediaPreview ? (
                                                <img src={mediaPreview} alt="Header" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="text-center group-hover:scale-110 transition-transform">
                                                    <i className="fa-solid fa-image text-4xl text-slate-300"></i>
                                                    <p className="text-[9px] font-black text-slate-300 uppercase mt-2 tracking-widest">Image Header</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {headerComp && currentHeaderFormat === 'VIDEO' && (
                                        <div className="bg-slate-900 h-44 flex items-center justify-center relative">
                                            {mediaPreview ? (
                                                <>
                                                    <video src={mediaPreview} className="w-full h-full object-cover opacity-60" />
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                        <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center shadow-lg border border-white/30">
                                                            <i className="fa-solid fa-play text-white ml-0.5"></i>
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="text-center">
                                                    <i className="fa-solid fa-video text-4xl text-slate-700"></i>
                                                    <p className="text-[9px] font-black text-slate-700 uppercase mt-2 tracking-widest">Video Header</p>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {headerComp && currentHeaderFormat === 'DOCUMENT' && (
                                        <div className="bg-slate-50 p-4 flex items-center gap-4 border-b border-gray-100">
                                            <div className="w-12 h-12 bg-rose-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg border border-rose-400">
                                                <i className="fa-solid fa-file-pdf text-white text-xl"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[13px] font-bold text-slate-800 truncate leading-tight">{headerComp._uploadedFileName || 'proposal_v1.pdf'}</p>
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mt-1">PDF • {headerComp._uploadedFileSize ? formatFileSize(headerComp._uploadedFileSize) : '2.4 MB'}</p>
                                            </div>
                                            <i className="fa-solid fa-chevron-down text-[#007aff] text-xs"></i>
                                        </div>
                                    )}

                                    {/* Text Content */}
                                    <div className="p-4 relative">
                                        {headerComp?.format === 'TEXT' && headerComp?.text && (
                                            <div className="font-extrabold text-[15px] text-[#111b21] mb-2 leading-tight">
                                                {headerComp.text}
                                            </div>
                                        )}
                                        <div className="text-[14.5px] text-[#3c4144] whitespace-pre-wrap leading-[20px] font-medium">
                                            {renderPreviewText(bodyComp?.text)}
                                        </div>
                                        {footerComp?.text && (
                                            <div className="text-[11px] text-[#8696a0] mt-3 font-semibold uppercase tracking-wide">
                                                {footerComp.text}
                                            </div>
                                        )}
                                        <div className="text-[10px] text-[#8696a0] mt-4 flex items-center justify-end gap-1.5 font-bold">
                                            12:00 PM <i className="fa-solid fa-check-double text-[#53bdeb]"></i>
                                        </div>
                                    </div>

                                    {/* Realistic Buttons Preview */}
                                    {btnComp?.buttons?.length > 0 && (
                                        <div className="border-t border-gray-100 flex flex-col bg-gray-50/10">
                                            {btnComp.buttons.map((btn, idx) => (
                                                <div key={idx} className={`w-full py-3.5 text-center flex items-center justify-center gap-2 group/btn active:bg-gray-100 transition-colors cursor-pointer ${idx < btnComp.buttons.length - 1 ? 'border-b border-gray-100' : ''}`}>
                                                    <i className={`fa-solid ${btn.type === 'URL' ? 'fa-arrow-up-right-from-square' :
                                                            btn.type === 'PHONE_NUMBER' ? 'fa-phone-flip' : 'fa-reply-all'
                                                        } text-[#007aff] text-[10px] group-hover/btn:scale-110 transition-transform`}></i>
                                                    <span className="text-[#007aff] text-[14px] font-bold tracking-tight">
                                                        {btn.text || `Action Button ${idx + 1}`}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Custom Bottom Input Bar */}
                        <div className="bg-[#f0f2f5] px-4 py-3 pb-8 flex items-center gap-3">
                            <i className="fa-solid fa-plus text-[#007aff] text-xl"></i>
                            <div className="flex-1 bg-white rounded-2xl px-4 py-2 border border-gray-200 shadow-sm">
                                <span className="text-sm text-slate-300">Message</span>
                            </div>
                            <i className="fa-solid fa-camera text-[#007aff] text-xl"></i>
                            <i className="fa-solid fa-microphone text-[#007aff] text-xl"></i>
                        </div>
                    </div>
                </div>

                {/* Analytics (if editing existing template) */}
                {analytics && analytics.sent > 0 && (
                    <div className="mt-8 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Template Analytics</h4>
                        <div className="grid grid-cols-4 gap-2 text-center">
                            {[
                                { label: 'Sent', value: analytics.sent, color: 'text-slate-700' },
                                { label: 'Delivered', value: analytics.delivered, color: 'text-emerald-600' },
                                { label: 'Read', value: analytics.read, color: 'text-blue-600' },
                                { label: 'Failed', value: analytics.failed, color: 'text-rose-600' },
                            ].map(metric => (
                                <div key={metric.label}>
                                    <div className={`text-sm font-black ${metric.color}`}>{metric.value || 0}</div>
                                    <div className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{metric.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(TemplatePhonePreview);
