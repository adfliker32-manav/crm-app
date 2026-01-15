/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useRef } from 'react';

const WhatsAppInbox = () => {
    // Initialize with mock data directly to avoid setState in useEffect
    const [conversations, setConversations] = useState([
        { id: 1, name: 'John Doe', number: '+1 (555) 123-4567', lastMessage: 'Thanks for the info!', time: '10:30 AM', unread: 2 },
        { id: 2, name: 'Jane Smith', number: '+1 (555) 987-6543', lastMessage: 'When is the meeting?', time: 'Yesterday', unread: 0 },
        { id: 3, name: 'Mike Johnson', number: '+1 (555) 567-8901', lastMessage: 'Confirmed.', time: 'Oct 23', unread: 0 },
    ]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const scrollRef = useRef(null);

    // Mock fetch messages when chat is selected
    useEffect(() => {
        if (selectedChat) {
            // In reality, fetch from /api/whatsapp/messages/:chatId
            const mockMessages = [
                { id: 1, text: 'Hello, I am interested in your services.', sender: 'them', time: '10:00 AM' },
                { id: 2, text: 'Hi! I would be happy to help. What specific services are you looking for?', sender: 'me', time: '10:05 AM' },
                { id: 3, text: 'I need help with marketing automation.', sender: 'them', time: '10:06 AM' },
                { id: 4, text: 'Great, we specialize in that. Do you have a specific platform in mind?', sender: 'me', time: '10:10 AM' },
                { id: 5, text: 'Not really, open to suggestions.', sender: 'them', time: '10:12 AM' },
            ];
            setMessages(mockMessages);
        }
    }, [selectedChat]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (!newMessage.trim()) return;

        // Mock send
        const msg = {
            id: Date.now(),
            text: newMessage,
            sender: 'me',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages([...messages, msg]);
        setNewMessage('');

        // Update last message in conversation list
        setConversations(prev => prev.map(c =>
            c.id === selectedChat.id ? { ...c, lastMessage: newMessage, time: 'Just now' } : c
        ));
    };

    const filteredConversations = conversations.filter(c =>
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.number.includes(searchTerm)
    );

    return (
        <div className="flex h-[calc(100vh-250px)] bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
            {/* Left Sidebar: Conversations */}
            <div className="w-1/3 border-r border-slate-200 flex flex-col bg-slate-50">
                <div className="p-4 border-b border-slate-200 bg-white">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input
                            type="text"
                            placeholder="Search chats..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm bg-slate-50 focus:bg-white transition"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {filteredConversations.map(chat => (
                        <div
                            key={chat.id}
                            onClick={() => setSelectedChat(chat)}
                            className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition relative ${selectedChat?.id === chat.id ? 'bg-blue-50 hover:bg-blue-50 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
                                }`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <h4 className="font-bold text-slate-800 text-sm">{chat.name}</h4>
                                <span className="text-xs text-slate-500">{chat.time}</span>
                            </div>
                            <p className="text-xs text-slate-500 mb-1">{chat.number}</p>
                            <div className="flex justify-between items-center">
                                <p className="text-sm text-slate-600 truncate max-w-[180px]">{chat.lastMessage}</p>
                                {chat.unread > 0 && (
                                    <span className="bg-green-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                                        {chat.unread}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                    {filteredConversations.length === 0 && (
                        <div className="p-8 text-center text-slate-400 text-sm">
                            No conversations found
                        </div>
                    )}
                </div>
            </div>

            {/* Right Pane: Chat Window */}
            <div className="flex-1 flex flex-col bg-[#e5ded8] relative">
                {/* Whatsapp-like background color/pattern could go here */}
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")' }}></div>

                {selectedChat ? (
                    <>
                        {/* Chat Header */}
                        <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-500">
                                    <i className="fa-solid fa-user"></i>
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800">{selectedChat.name}</h3>
                                    <p className="text-xs text-slate-500">{selectedChat.number}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                                    <i className="fa-solid fa-phone"></i>
                                </button>
                                <button className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                                    <i className="fa-solid fa-ellipsis-v"></i>
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 z-0" ref={scrollRef}>
                            {messages.map((msg) => (
                                <div
                                    key={msg.id}
                                    className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div
                                        className={`max-w-[70%] rounded-lg p-3 shadow-sm relative ${msg.sender === 'me'
                                            ? 'bg-[#d9fdd3] text-slate-800 rounded-tr-none'
                                            : 'bg-white text-slate-800 rounded-tl-none'
                                            }`}
                                    >
                                        <p className="text-sm leading-relaxed">{msg.text}</p>
                                        <p className="text-[10px] text-slate-500 text-right mt-1 flex items-center justify-end gap-1">
                                            {msg.time}
                                            {msg.sender === 'me' && <i className="fa-solid fa-check-double text-blue-500"></i>}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Input Area */}
                        <div className="p-3 bg-white border-t border-slate-200 z-10">
                            <form onSubmit={handleSendMessage} className="flex gap-2 items-end">
                                <button
                                    type="button"
                                    className="p-3 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
                                    title="Add Attachment"
                                >
                                    <i className="fa-solid fa-paperclip"></i>
                                </button>
                                <button
                                    type="button"
                                    className="p-3 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition"
                                    title="Use Template"
                                >
                                    <i className="fa-solid fa-bolt"></i>
                                </button>

                                <div className="flex-1 bg-slate-100 rounded-lg flex items-center">
                                    <textarea
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage(e);
                                            }
                                        }}
                                        placeholder="Type a message..."
                                        className="w-full bg-transparent border-none focus:ring-0 p-3 text-sm resize-none max-h-32"
                                        rows="1"
                                    />
                                    <button
                                        type="button"
                                        className="p-3 text-slate-400 hover:text-slate-600"
                                    >
                                        <i className="fa-regular fa-face-smile"></i>
                                    </button>
                                </div>

                                <button
                                    type="submit"
                                    disabled={!newMessage.trim()}
                                    className="p-3 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-md transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <i className="fa-solid fa-paper-plane"></i>
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 z-10">
                        <div className="w-24 h-24 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                            <i className="fa-brands fa-whatsapp text-5xl text-slate-400"></i>
                        </div>
                        <h3 className="text-xl font-bold text-slate-600">WhatsApp for Business</h3>
                        <p className="text-sm mt-2">Select a conversation to start chatting</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WhatsAppInbox;
