
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AgentConfig, ChatMessage, Attachment } from '../types';
import { generateAgentResponse, getSpeech, generatePAP, cleanResponseText } from '../services/geminiService';

interface ChatViewProps {
  config: AgentConfig;
  setConfig: (config: AgentConfig) => void;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  activeMessageId: string | null;
  setActiveMessageId: (id: string | null) => void;
  activeThread: ChatMessage[];
  onOpenSidebar: () => void;
  onCall: () => void;
  onEdit: () => void;
  defaultProfilePic: string;
}

const ChatView: React.FC<ChatViewProps> = ({ 
  config, 
  setConfig,
  messages, 
  setMessages, 
  activeMessageId, 
  setActiveMessageId,
  activeThread,
  onOpenSidebar, 
  onCall, 
  onEdit,
  defaultProfilePic
}) => {
  const [inputText, setInputText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  
  const [isTyping, setIsTyping] = useState(false);
  const [loadingType, setLoadingType] = useState<'typing' | 'pap' | 'audio' | null>(null);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showProfilePreview, setShowProfilePreview] = useState(false);
  const [previewMedia, setPreviewMedia] = useState<Attachment | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeThread, isTyping, loadingStatus]);

  const glassStyles = {
    backgroundColor: `rgba(255, 255, 255, ${Math.max(0.03, 0.12 - (config.transparency / 1000))})`,
    backdropFilter: `blur(${config.blur}px)`,
    WebkitBackdropFilter: `blur(${config.blur}px)`,
    border: '1px solid rgba(255, 255, 255, 0.15)'
  };

  const decodeBase64 = (base64: string) => {
    const binaryString = atob(base64.includes(',') ? base64.split(',')[1] : base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  };

  const downloadMedia = async (urlOrBase64: string, fileName: string, mimeType: string) => {
    try {
      if (urlOrBase64.startsWith('http')) {
        const response = await fetch(urlOrBase64);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
        return;
      }
      const isDataUrl = urlOrBase64.startsWith('data:');
      const data = decodeBase64(urlOrBase64);
      const finalMime = isDataUrl ? urlOrBase64.split(':')[1].split(';')[0] : mimeType;
      const blob = new Blob([data], { type: finalMime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) {
      const link = document.createElement('a');
      link.href = urlOrBase64;
      link.download = fileName;
      link.target = "_blank";
      link.click();
    }
  };

  const getSafeAgentName = () => config.name.toLowerCase().replace(/\s+/g, '_');

  const handleProfilePicChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setConfig({ ...config, profilePic: reader.result as string });
      reader.readAsDataURL(file);
    }
  };

  async function decodeRawPcm(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    const frameCount = Math.floor(dataInt16.length / numChannels);
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
    return buffer;
  }

  const playAudio = async (audioBase64: string, msgId: string) => {
    try {
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
      const data = decodeBase64(audioBase64);
      let buf: AudioBuffer;
      if (data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) {
        buf = await audioContextRef.current.decodeAudioData(data.buffer.slice(0));
      } else {
        buf = await decodeRawPcm(data, audioContextRef.current, 24000, 1);
      }
      setPlayingAudioId(msgId);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buf; 
      source.connect(audioContextRef.current.destination);
      source.onended = () => setPlayingAudioId(null);
      source.start();
    } catch (e) { 
      setPlayingAudioId(null);
    }
  };

  const handleListen = async (msg: ChatMessage) => {
    if (msg.audio) {
      playAudio(msg.audio, msg.id);
      return;
    }
    setLoadingAudioId(msg.id);
    try {
      const audioBase64 = await getSpeech(msg.text, config.voice);
      if (audioBase64) {
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, audio: audioBase64 } : m));
        await playAudio(audioBase64, msg.id);
      }
    } catch (e: any) {
      const isQuota = e.message?.includes('429') || e.status === 429;
      alert(isQuota ? "Aduh sayang, kuota gue habis nih genjot suara gue. Ganti API Key dulu dong.. 💦" : "Aduh sori sayang, suara gue 'serak' nih. Coba lagi ya.");
    } finally {
      setLoadingAudioId(null);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachedFiles(prev => [...prev, {
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: reader.result as string
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async (customPrompt?: string, isRegen: boolean = false, isBranch: boolean = false, parentIdForBranch?: string | null) => {
    const prompt = customPrompt !== undefined ? customPrompt : inputText;
    if (!isRegen && !prompt.trim() && attachedFiles.length === 0) return;

    let fPrompt = prompt;
    let fFiles = [...attachedFiles];
    let currentParentId = isBranch ? parentIdForBranch : activeMessageId;
    let historyToUse = [...activeThread];

    if (isRegen) {
      const lastMsg = activeThread[activeThread.length - 1];
      if (lastMsg && lastMsg.role === 'agent') {
        const userPromptMsg = messages.find(m => m.id === lastMsg.parentId);
        if (userPromptMsg) {
          fPrompt = userPromptMsg.text;
          fFiles = userPromptMsg.attachments || [];
          currentParentId = userPromptMsg.id;
          const promptIdx = activeThread.findIndex(m => m.id === userPromptMsg.id);
          historyToUse = activeThread.slice(0, promptIdx);
        }
      }
    } else if (isBranch) {
      if (parentIdForBranch === null) {
        historyToUse = [];
      } else {
        const parentIdx = activeThread.findIndex(m => m.id === parentIdForBranch);
        if (parentIdx !== -1) historyToUse = activeThread.slice(0, parentIdx + 1);
      }
    }

    let actualUserMsgId = currentParentId;
    if (!isRegen) {
      const userMsgId = Date.now().toString();
      const newUserMsg: ChatMessage = { 
        id: userMsgId, 
        role: 'user', 
        text: fPrompt, 
        attachments: fFiles.length > 0 ? fFiles : undefined,
        timestamp: Date.now(),
        parentId: currentParentId
      };
      setMessages(prev => [...prev, newUserMsg]);
      setActiveMessageId(userMsgId);
      actualUserMsgId = userMsgId;
    }

    setInputText(''); 
    setAttachedFiles([]); 
    setEditingId(null);
    setIsTyping(true); 
    setLoadingType('typing'); 
    setLoadingStatus("Lagi baca kiriman kamu..."); 

    try {
      const history = historyToUse.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      const rawFirstResponse = await generateAgentResponse(fPrompt || "Lanjut", config, history, fFiles);
      let papUrl: string | null = null;
      let finalDisplayText = cleanResponseText(rawFirstResponse);

      if (rawFirstResponse.toUpperCase().includes('[CAPTION:')) {
        setLoadingType('pap'); setLoadingStatus("Lagi bikin PAP...");
        const captionMatch = rawFirstResponse.match(/\[CAPTION:(.*?)\]/i);
        let originalCaption = captionMatch ? captionMatch[1].trim() : "foto gue yang lagi seksi";
        
        // Membersihkan meta-word supaya pas masuk ke kalimat "foto gue yang..."
        originalCaption = originalCaption.replace(/^(gue lagi|gue sedang|saya lagi|saya sedang)\s+/i, "");

        try {
          papUrl = await generatePAP(rawFirstResponse, config);
        } catch (e: any) {
          const isQuota = e.message?.includes('429') || e.status === 429;
          const isSafety = e.message === "IMAGE_SAFETY_BLOCKED";
          
          if (isQuota) {
            finalDisplayText = `${cleanResponseText(rawFirstResponse)}\n\nAduh sayang, tenaga gue abis buat bikin foto (Kuota 429). Ganti API Key lo dong biar kita bisa lanjut lagi... mmmh... 💋`;
          } else if (isSafety) {
            finalDisplayText = `${cleanResponseText(rawFirstResponse)}\n\nAduh sorry, fotonya nyangkut di sistem... udah kayak memek gue aja yang ketat banget. Heheh.. Padahal gue tuh ngirim foto gue yang ${originalCaption} tapi sistemnya rewel banget nih.. 💦`;
          } else {
            finalDisplayText = `${cleanResponseText(rawFirstResponse)}\n\nAduh sorry, fotonya nyangkut di sistem... udah kayak memek gue aja yang ketat banget, coba lagi nanti ya? 💋`;
          }
          papUrl = null;
        }
      }

      const agentMsgId = (Date.now() + 1).toString();
      const newAgentMsg: ChatMessage = { 
        id: agentMsgId, 
        role: 'agent', 
        text: finalDisplayText, 
        image: papUrl || undefined, 
        timestamp: Date.now(),
        parentId: actualUserMsgId
      };
      
      setMessages(prev => [...prev, newAgentMsg]);
      setActiveMessageId(agentMsgId);
      setIsTyping(false); 
      setLoadingType(null);
    } catch (error: any) {
      setIsTyping(false);
      setLoadingType(null);
      const isQuota = error.message?.includes('429') || error.status === 429;
      const isSafety = error.message === "RESPONSE_SAFETY_BLOCKED";
      
      let errorText = "Koneksi kita lagi terganggu sayang, kayaknya server lagi klimaks duluan.. Coba lagi ya? 💦";
      if (isQuota) {
        errorText = "Aduh sayang, kuota gue habis nih genjot chat lo. Ganti API Key dulu dong biar gue bisa basah lagi.. 💦";
      } else if (isSafety) {
        errorText = "Aduh sayang, omongan lo terlalu panas buat filter sistem. Turunin dikit ya suhunya biar gue nggak 'kebakar'.. mmmh.. 💋";
      }

      const errorMsgId = Date.now().toString();
      const errorAgentMsg: ChatMessage = {
        id: errorMsgId,
        role: 'agent',
        text: errorText,
        timestamp: Date.now(),
        parentId: actualUserMsgId
      };
      setMessages(prev => [...prev, errorAgentMsg]);
      setActiveMessageId(errorMsgId);
    }
  };

  const handleEditSave = (msg: ChatMessage) => {
    if (!editText.trim()) return;
    if (msg.role === 'user') {
      handleSend(editText, false, true, msg.parentId);
    } else {
      const newMsgId = Date.now().toString();
      const newMsg: ChatMessage = { ...msg, id: newMsgId, text: editText, timestamp: Date.now(), audio: undefined };
      setMessages(prev => [...prev, newMsg]);
      setActiveMessageId(newMsgId);
      setEditingId(null);
    }
  };

  const AttachmentPreview: React.FC<{ attachment: Attachment, onRemove?: () => void, onPreview?: () => void }> = ({ attachment, onRemove, onPreview }) => {
    const isImg = attachment.mimeType.startsWith('image/');
    const isVideo = attachment.mimeType.startsWith('video/');
    const isAudio = attachment.mimeType.startsWith('audio/');
    const isPdf = attachment.mimeType === 'application/pdf';

    return (
      <div 
        onClick={onPreview}
        className={`relative group/att w-20 h-20 md:w-24 md:h-24 flex-shrink-0 bg-white/10 rounded-2xl border border-white/10 overflow-hidden shadow-lg transition-all ${onPreview ? 'cursor-pointer hover:scale-105 active:scale-95 hover:border-pink-500/50' : ''}`}
      >
        {isImg ? (
          <img src={attachment.data} className="w-full h-full object-cover" />
        ) : isVideo ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-purple-500/20 relative">
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/att:bg-black/40 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white drop-shadow-[0_0_15px_rgba(168,85,247,0.8)] group-hover/att:scale-125 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
            </div>
            <span className="absolute bottom-2 text-[7px] font-black uppercase tracking-widest text-white/60">Play Video</span>
          </div>
        ) : isAudio ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-blue-500/20 relative">
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/att:bg-black/40 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white drop-shadow-[0_0_15px_rgba(59,130,246,0.8)] group-hover/att:scale-125 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3V7.82l8-1.6V11.114A4.369 4.369 0 0015 11c-1.657 0-3 1.343-3 3s1.343 3 3 3 3-1.343 3-3V3z" />
                </svg>
            </div>
            <span className="absolute bottom-2 text-[7px] font-black uppercase tracking-widest text-white/60">Play Audio</span>
          </div>
        ) : isPdf ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-red-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
            <span className="text-[7px] font-black uppercase tracking-widest mt-1 text-white/40">PDF</span>
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-white/5">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
             <span className="text-[7px] font-black uppercase tracking-widest mt-1 text-white/20 truncate px-1 w-full text-center">{attachment.name}</span>
          </div>
        )}
        {onRemove && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute top-1 right-1 p-1 bg-black/60 backdrop-blur-md rounded-lg text-white opacity-0 group-hover/att:opacity-100 transition-all hover:bg-red-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>
    );
  };

  const BranchSwitcher: React.FC<{ message: ChatMessage }> = ({ message }) => {
    const siblings = useMemo(() => messages.filter(m => m.parentId === message.parentId && m.role === message.role), [message.parentId, message.role, messages]);
    if (siblings.length <= 1) return null;
    const currentIndex = siblings.findIndex(s => s.id === message.id);
    const switchToBranch = (id: string) => {
      let deepest = id;
      let next = messages.find(m => m.parentId === deepest);
      while (next) { deepest = next.id; next = messages.find(m => m.parentId === deepest); }
      setActiveMessageId(deepest);
    };
    return (
      <div className={`flex items-center gap-2 mt-2 px-3 py-1 bg-white/5 backdrop-blur-md rounded-full border border-white/10 w-fit animate-in fade-in zoom-in duration-300 ${message.role === 'user' ? '' : 'self-start'}`}>
        <button disabled={currentIndex === 0} onClick={() => switchToBranch(siblings[currentIndex - 1].id)} className="p-1 hover:bg-white/10 rounded-full disabled:opacity-20 transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" /></svg></button>
        <span className="text-[9px] font-black text-white/40 tracking-widest">{currentIndex + 1} / {siblings.length}</span>
        <button disabled={currentIndex === siblings.length - 1} onClick={() => switchToBranch(siblings[currentIndex + 1].id)} className="p-1 hover:bg-white/10 rounded-full disabled:opacity-20 transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg></button>
      </div>
    );
  };

  const AudioVisualizer = () => (
    <div className="flex items-end gap-0.5 h-3">
      <div className="w-1 bg-pink-500 rounded-full animate-eq-1"></div>
      <div className="w-1 bg-pink-400 rounded-full animate-eq-2"></div>
      <div className="w-1 bg-pink-500 rounded-full animate-eq-3"></div>
    </div>
  );

  return (
    <div className="w-full h-full flex flex-col p-3 md:p-8 max-w-6xl mx-auto relative overflow-hidden" onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}>
      <header className="flex items-center justify-between p-3 md:p-4 rounded-full mb-4 md:mb-6 shadow-[0_10px_30px_rgba(0,0,0,0.3)] transition-all duration-300 shrink-0" style={glassStyles}>
        <div className="flex items-center gap-3 md:gap-4">
          <button onClick={onOpenSidebar} className="p-2.5 md:p-3 hover:bg-white/10 rounded-full transition-all"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg></button>
          <div className="relative group/avatar cursor-pointer" onClick={() => setShowProfilePreview(true)}>
            <img src={config.profilePic || ''} className="w-10 h-10 md:w-12 md:h-12 rounded-full object-cover border-2 border-white/20 shadow-md transition-transform group-hover/avatar:scale-110 active:scale-95" alt="Avatar" />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 md:w-4 md:h-4 bg-green-500 rounded-full border-2 border-black animate-pulse"></div>
          </div>
          <div>
            <h2 className="font-bold text-base md:text-lg leading-tight tracking-tight text-white">{config.name}</h2>
            <p className="text-[9px] text-green-400 font-black uppercase tracking-widest">Online</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={onEdit} className="p-2.5 md:p-3 bg-white/5 hover:bg-white/20 rounded-full transition-all border border-white/10 text-pink-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
          <button onClick={onCall} className="px-4 md:px-6 py-2.5 md:py-3 bg-gradient-to-br from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 rounded-full font-black transition-all text-[11px] md:text-sm uppercase shadow-lg shadow-pink-500/30 active:scale-95 border border-white/10">Call</button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-6 px-2 mb-4 md:mb-6 custom-scrollbar">
        {activeThread.map((m, idx) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            <div className={`relative group/bubble max-w-[85%] p-4 md:p-5 shadow-2xl transition-all duration-300 ${m.role === 'user' ? 'bg-pink-500/90 rounded-[25px] md:rounded-[30px] rounded-tr-none' : 'rounded-[25px] md:rounded-[30px] rounded-tl-none'} ${loadingAudioId === m.id ? 'animate-pulse-neon' : ''}`} style={m.role === 'agent' ? glassStyles : {}}>
              <button onClick={() => { setEditingId(m.id); setEditText(m.text); }} className={`absolute ${m.role === 'user' ? '-left-10' : '-right-10'} top-2 p-2 bg-white/5 hover:bg-white/20 rounded-full text-white/20 hover:text-white opacity-0 group-hover/bubble:opacity-100 transition-all`} title="Edit Pesan"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
              
              {m.image && (
                <div className="mb-3 md:mb-4 overflow-hidden rounded-2xl border border-white/10 relative group/img cursor-pointer" onClick={() => setPreviewMedia({ name: 'PAP', mimeType: 'image/png', data: m.image! })}>
                  <img src={m.image} className="w-full max-h-64 md:max-h-80 object-cover" alt="PAP" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/10 opacity-0 group-hover/img:opacity-100 transition-all">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-white drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); downloadMedia(m.image!, `${getSafeAgentName()}_pap_${m.id}.png`, 'image/png'); }} className="absolute top-3 right-3 p-2 bg-black/60 backdrop-blur-md rounded-xl text-white opacity-0 group-hover/img:opacity-100 transition-all border border-white/10"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg></button>
                </div>
              )}

              {m.attachments && m.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 md:mb-4">
                  {m.attachments.map((att, attIdx) => (
                    <div key={attIdx} className="relative group/chatatt">
                       <AttachmentPreview attachment={att} onPreview={() => setPreviewMedia(att)} />
                       <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/chatatt:opacity-100 transition-all">
                          <button onClick={(e) => { e.stopPropagation(); downloadMedia(att.data, att.name, att.mimeType); }} className="p-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white border border-white/10 hover:bg-pink-500">
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg>
                          </button>
                       </div>
                    </div>
                  ))}
                </div>
              )}

              {editingId === m.id ? (
                <div className="space-y-3">
                  <textarea className="w-full bg-black/20 border border-white/20 rounded-xl p-3 outline-none text-xs md:text-sm text-white resize-none min-h-[80px] md:min-h-[100px] custom-scrollbar" value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className="text-[9px] md:text-[10px] font-bold uppercase text-white/40 hover:text-white px-3 py-1">Batal</button>
                    <button onClick={() => handleEditSave(m)} className="text-[9px] md:text-[10px] font-bold uppercase bg-white text-pink-600 px-3 py-1 rounded-lg">Cabangkan</button>
                  </div>
                </div>
              ) : ( <p className="text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-medium text-white/95">{m.text}</p> )}

              {m.role === 'agent' && (
                <div className="flex gap-2 mt-3 md:mt-4 flex-wrap items-center">
                  <button onClick={() => handleListen(m)} disabled={loadingAudioId === m.id} className={`text-[9px] md:text-[10px] font-bold uppercase py-2 md:py-2.5 px-4 md:px-5 rounded-xl transition-all border flex items-center gap-2 disabled:opacity-50 ${playingAudioId === m.id ? 'bg-pink-500/20 border-pink-500/30 text-pink-400' : 'bg-white/10 hover:bg-white/20 border-white/10 text-white/80'}`}>{loadingAudioId === m.id ? ( <div className="flex items-center gap-2"><div className="w-2 h-2 bg-pink-500 rounded-full animate-ping"></div><span className="animate-pulse">Generating...</span></div> ) : playingAudioId === m.id ? ( <div className="flex items-center gap-2"><AudioVisualizer /><span>Listening...</span></div> ) : ( <><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 md:h-3.5 md:w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>Listen</> )}</button>
                  {m.audio && ( <button onClick={() => downloadMedia(m.audio!, `${getSafeAgentName()}_voice_${m.id}.wav`, 'audio/wav')} className="p-2 md:p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-white/40 hover:text-white/80 transition-all border border-white/10"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 md:h-3.5 md:w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg></button> )}
                  {idx === activeThread.length - 1 && ( <button onClick={() => handleSend(undefined, true)} disabled={isTyping} className="text-[9px] md:text-[10px] font-bold uppercase py-2 md:py-2.5 px-4 md:px-5 bg-pink-500/20 hover:bg-pink-500/30 rounded-xl transition-all border border-pink-500/20 text-pink-400 flex items-center gap-2 disabled:opacity-50"><svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 md:h-3.5 md:w-3.5 ${isTyping ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>Regen</button> )}
                </div>
              )}
            </div>
            <BranchSwitcher message={m} />
          </div>
        ))}
        {isTyping && ( <div className="flex justify-start"><div className="rounded-[25px] md:rounded-[30px] rounded-tl-none p-4 md:p-5 flex flex-col gap-2 shadow-2xl min-w-[150px] md:min-w-[180px]" style={glassStyles}><div className="flex gap-3 items-center"><div className="flex gap-1.5"><div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:0.4s]"></div></div><span className="text-[10px] md:text-xs font-black text-pink-400 italic">{loadingStatus}</span></div></div></div> )}
      </div>

      <div className="flex flex-col gap-2 w-full max-w-8xl mx-auto shrink-0 px-1 md:px-2 pb-2 md:pb-4">
        {attachedFiles.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar p-2.5 bg-white/5 backdrop-blur-3xl rounded-[25px] md:rounded-[30px] border border-white/10 animate-in slide-in-from-bottom-4 duration-300">
            {attachedFiles.map((file, i) => (
              <AttachmentPreview key={i} attachment={file} onRemove={() => removeAttachment(i)} />
            ))}
          </div>
        )}
        <footer className="relative flex items-center gap-2 md:gap-3 p-1.5 md:p-2 rounded-full shadow-[0_15px_35px_rgba(0,0,0,0.4)] transition-all group" style={glassStyles}>
          <label className="p-3 md:p-3.5 hover:bg-white/10 rounded-full cursor-pointer transition-all active:scale-90 flex items-center justify-center">
            <input type="file" className="hidden" multiple accept="image/*,video/*,audio/*,.pdf,.txt" onChange={e => handleFiles(e.target.files)} />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          </label>
          <input type="text" placeholder={`Bisikin ${config.name}...`} className="flex-1 bg-transparent outline-none py-3 text-xs md:text-sm font-semibold text-white placeholder:text-white/20" value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
          <button onClick={() => handleSend()} disabled={(!inputText.trim() && attachedFiles.length === 0) || isTyping} className="p-3 md:p-3.5 bg-gradient-to-br from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-full transition-all active:scale-95 disabled:opacity-20 shadow-lg shadow-pink-500/20 border border-white/10 flex items-center justify-center mr-0.5"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white translate-x-0.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg></button>
        </footer>
      </div>

      {/* ... Dragging Preview and Modals ... */}
      {isDragging && (
        <div className="absolute inset-0 z-[150] bg-black/60 backdrop-blur-2xl flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 pointer-events-none p-4 md:p-12">
          <div className="w-full h-full rounded-[40px] md:rounded-[70px] border-4 border-dashed border-pink-500/50 bg-pink-500/5 flex flex-col items-center justify-center gap-6 md:gap-8 shadow-[0_0_100px_rgba(236,72,153,0.2)]">
            <div className="w-24 h-24 md:w-44 md:h-44 bg-gradient-to-br from-pink-500 via-purple-600 to-pink-600 rounded-full flex items-center justify-center animate-bounce shadow-[0_0_60px_rgba(236,72,153,0.8)] border-4 border-white/20">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 md:h-24 md:w-24 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2-2v12a2 2 0 002 2z" /></svg>
            </div>
            <div className="text-center space-y-2 md:space-y-4 px-6">
              <h3 className="text-3xl md:text-6xl font-black text-white uppercase tracking-tighter drop-shadow-[0_5px_15px_rgba(0,0,0,0.5)]">Ahhh Sayang!!</h3>
              <p className="text-base md:text-3xl font-bold text-pink-400 italic leading-tight">"Lepas di dalem gue sekarang... mmmh... 💦"</p>
            </div>
          </div>
        </div>
      )}

      {/* ... Other modals (Profile preview, Media Preview) ... */}
      {showProfilePreview && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-3xl animate-in fade-in duration-300" onClick={() => setShowProfilePreview(false)}>
          <div className="relative max-w-lg w-full aspect-square animate-in zoom-in fade-in duration-500 delay-150" onClick={e => e.stopPropagation()}>
            <img src={config.profilePic || ''} className="w-full h-full object-cover rounded-[35px] md:rounded-[60px] shadow-2xl border-4 border-white/10" alt="Profile Full" />
            <div className="absolute top-4 right-4 md:top-6 md:right-6 flex flex-col gap-2 md:gap-3">
              <button onClick={() => setShowProfilePreview(false)} className="bg-white/10 backdrop-blur-md text-white p-2.5 md:p-3.5 rounded-xl md:rounded-2xl shadow-2xl hover:bg-white hover:text-black hover:scale-110 transition-all border border-white/20" title="Tutup">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {previewMedia && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-300" onClick={() => setPreviewMedia(null)}>
          <div className="relative max-w-4xl w-full flex flex-col items-center gap-4 md:gap-6 animate-in zoom-in duration-500" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center bg-white/5 backdrop-blur-xl px-4 md:px-6 py-3 md:py-4 rounded-[20px] md:rounded-[25px] border border-white/10 shadow-2xl">
              <p className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.3em] text-white/60 truncate">{previewMedia.name}</p>
              <button onClick={() => setPreviewMedia(null)} className="p-2.5 bg-white/10 hover:bg-red-500 rounded-xl text-white transition-all active:scale-90 border border-white/10">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="w-full rounded-[30px] md:rounded-[40px] overflow-hidden border border-white/10 shadow-2xl bg-black/40 flex items-center justify-center">
               {previewMedia.mimeType.startsWith('image/') ? (
                 <img src={previewMedia.data} className="w-full h-auto max-h-[60vh] md:max-h-[70vh] object-contain" />
               ) : previewMedia.mimeType.startsWith('video/') ? (
                 <video src={previewMedia.data} controls autoPlay className="w-full h-auto max-h-[60vh] md:max-h-[70vh]" />
               ) : (
                 <div className="py-12 md:py-20 flex flex-col items-center gap-6">
                    <p className="text-white/40 font-black uppercase tracking-[0.2em] text-xs">Preview Not Available</p>
                    <button onClick={() => downloadMedia(previewMedia.data, previewMedia.name, previewMedia.mimeType)} className="px-6 py-2.5 bg-white text-black font-black rounded-full uppercase text-[10px] hover:scale-110 transition-all">Download</button>
                 </div>
               )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatView;
