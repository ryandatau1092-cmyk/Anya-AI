
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
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

  const handleProfileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setConfig({ ...config, profilePic: reader.result as string });
        setShowProfilePreview(false); 
      };
      reader.readAsDataURL(file);
    }
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
      const errorAgentMsg: ChatMessage = { id: errorMsgId, role: 'agent', text: errorText, timestamp: Date.now(), parentId: actualUserMsgId };
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
    return (
      <div 
        onClick={onPreview}
        className={`relative group/att w-20 h-20 md:w-24 md:h-24 flex-shrink-0 bg-white/10 rounded-2xl border border-white/10 overflow-hidden shadow-lg transition-all ${onPreview ? 'cursor-pointer hover:scale-105 active:scale-95 hover:border-pink-500/50' : ''}`}
      >
        {isImg ? ( <img src={attachment.data} className="w-full h-full object-cover" /> ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-white/5 text-[7px] font-black uppercase text-white/20 px-1 text-center truncate">{attachment.name}</div>
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
    <div className="w-full h-[100dvh] flex flex-col max-w-6xl mx-auto relative overflow-hidden" 
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }} 
      onDragLeave={() => setIsDragging(false)} 
      onDrop={e => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
    >
      {/* DRAG AND DROP FEEDBACK OVERLAY */}
      {isDragging && (
        <div className="fixed inset-0 z-[1000] bg-pink-600/20 backdrop-blur-md flex flex-col items-center justify-center p-10 border-[10px] border-dashed border-pink-500/50 m-4 rounded-[50px] animate-in fade-in duration-300">
           <div className="bg-white/10 backdrop-blur-3xl p-12 rounded-full border border-white/20 shadow-2xl animate-pulse-neon">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
           </div>
           <h2 className="text-3xl font-black text-white mt-8 tracking-tighter uppercase drop-shadow-2xl">Drop it here, darling...</h2>
           <p className="text-white/40 font-bold uppercase tracking-[0.5em] mt-2">Masukin aja semuanya...</p>
        </div>
      )}
      
      <div className="w-full p-3 shrink-0 z-[100]">
        <header className="flex items-center justify-between w-full p-3 md:p-5 rounded-[30px] shadow-[0_15px_40px_rgba(0,0,0,0.6)] border border-white/20 transition-all" style={glassStyles}>
          <div className="flex items-center gap-3 md:gap-5">
            <button onClick={onOpenSidebar} className="p-2.5 md:p-3 hover:bg-white/10 rounded-full transition-all text-white/70 active:scale-90"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" /></svg></button>
            <div className="relative group/avatar cursor-pointer" onClick={() => setShowProfilePreview(true)}>
              <img src={config.profilePic || ''} className="w-10 h-10 md:w-14 md:h-14 rounded-full object-cover border-2 border-white/30 shadow-md transition-transform group-hover/avatar:scale-110 active:scale-95" alt="Avatar" />
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-black animate-pulse"></div>
            </div>
            <div className="overflow-hidden">
              <h2 className="font-black text-sm md:text-xl leading-tight tracking-tighter text-white truncate max-w-[120px] md:max-w-none">{config.name}</h2>
              <div className="flex items-center gap-1"><div className="w-1.5 h-1.5 bg-green-500 rounded-full"></div><p className="text-[8px] md:text-[10px] text-green-400 font-black uppercase tracking-[0.2em]">Online Now</p></div>
            </div>
          </div>
          <div className="flex gap-2.5 items-center pr-2">
            <button onClick={onEdit} className="p-3 bg-white/5 hover:bg-pink-500/20 rounded-2xl transition-all border border-white/10 text-white/50 hover:text-pink-400 active:scale-90"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
            <button onClick={onCall} className="px-5 md:px-8 py-2.5 md:py-3.5 bg-gradient-to-br from-pink-500 to-pink-700 hover:from-pink-600 hover:to-pink-800 rounded-full font-black transition-all text-[11px] md:text-sm uppercase shadow-xl shadow-pink-500/30 active:scale-95 border border-white/20 tracking-widest">Call</button>
          </div>
        </header>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-6 px-5 py-4 custom-scrollbar scroll-smooth">
        {activeThread.map((m, idx) => (
          <div key={m.id} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 duration-300`}>
            <div className={`relative group/bubble max-w-[85%] p-4 md:p-5 shadow-2xl transition-all duration-300 ${m.role === 'user' ? 'bg-pink-500/90 rounded-[25px] md:rounded-[30px] rounded-tr-none text-white' : 'rounded-[25px] md:rounded-[30px] rounded-tl-none'} ${loadingAudioId === m.id ? 'animate-pulse-neon' : ''}`} style={m.role === 'agent' ? glassStyles : {}}>
              
              <div className={`absolute ${m.role === 'user' ? '-left-12' : '-right-12'} top-2 flex flex-col gap-2 opacity-0 group-hover/bubble:opacity-100 transition-all`}>
                <button onClick={() => { setEditingId(m.id); setEditText(m.text); }} className="p-2 bg-white/5 hover:bg-white/20 rounded-full text-white/20 hover:text-white transition-all" title="Edit Pesan"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg></button>
                {m.role === 'agent' && idx === activeThread.length - 1 && (
                  <button onClick={() => handleSend(undefined, true)} className="p-2 bg-pink-500/10 hover:bg-pink-500/30 rounded-full text-pink-500 transition-all" title="Regenerate Pesan"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
                )}
              </div>

              {m.image && (
                <div className="mb-3 md:mb-4 overflow-hidden rounded-2xl border border-white/10 relative group/img cursor-pointer" onClick={() => setPreviewMedia({ name: 'PAP', mimeType: 'image/png', data: m.image! })}>
                  <img src={m.image} className="w-full max-h-64 md:max-h-80 object-cover" alt="PAP" />
                  <button onClick={(e) => { e.stopPropagation(); downloadMedia(m.image!, `${getSafeAgentName()}_pap_${m.id}.png`, 'image/png'); }} className="absolute top-3 right-3 p-2 bg-black/60 backdrop-blur-md rounded-xl text-white opacity-0 group-hover/img:opacity-100 transition-all border border-white/10 shadow-lg"><svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg></button>
                </div>
              )}
              {editingId === m.id ? (
                <div className="space-y-3">
                  <textarea className="w-full bg-black/20 border border-white/20 rounded-xl p-3 outline-none text-xs md:text-sm text-white resize-none min-h-[80px] custom-scrollbar" value={editText} onChange={e => setEditText(e.target.value)} autoFocus />
                  <div className="flex gap-2 justify-end"><button onClick={() => setEditingId(null)} className="text-[10px] font-bold uppercase text-white/40 hover:text-white px-3 py-1">Batal</button><button onClick={() => handleEditSave(m)} className="text-[10px] font-bold uppercase bg-white text-pink-600 px-3 py-1 rounded-lg">Cabangkan</button></div>
                </div>
              ) : ( <p className="text-xs md:text-sm leading-relaxed whitespace-pre-wrap font-medium text-white/95">{m.text}</p> )}
              
              {m.role === 'agent' && (
                <div className="flex gap-2 mt-4 flex-wrap items-center">
                  <button onClick={() => handleListen(m)} disabled={loadingAudioId === m.id} className={`text-[10px] font-bold uppercase py-2 px-5 rounded-xl transition-all border flex items-center gap-2 disabled:opacity-50 ${playingAudioId === m.id ? 'bg-pink-500/20 border-pink-500/30 text-pink-400' : 'bg-white/10 hover:bg-white/20 border-white/10 text-white/80'}`}>{loadingAudioId === m.id ? ( <div className="flex items-center gap-2"><div className="w-2 h-2 bg-pink-500 rounded-full animate-ping"></div><span className="animate-pulse">Generating...</span></div> ) : playingAudioId === m.id ? ( <div className="flex items-center gap-2"><AudioVisualizer /><span>Listening...</span></div> ) : ( <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>Listen</> )}</button>
                  {m.audio && (
                    <button onClick={() => downloadMedia(m.audio!, `${getSafeAgentName()}_voice_${m.id}.wav`, 'audio/wav')} className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-white/40 hover:text-white transition-all shadow-inner" title="Simpan Suara Siska">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg>
                    </button>
                  )}
                </div>
              )}
            </div>
            <BranchSwitcher message={m} />
          </div>
        ))}
        {isTyping && ( <div className="flex justify-start"><div className="rounded-[30px] rounded-tl-none p-5 flex flex-col gap-2 shadow-2xl min-w-[180px]" style={glassStyles}><div className="flex gap-3 items-center"><div className="flex gap-1.5"><div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce"></div><div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:0.2s]"></div><div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:0.4s]"></div></div><span className="text-xs font-black text-pink-400 italic">{loadingStatus}</span></div></div></div> )}
      </div>

      <div className="w-full p-4 shrink-0 space-y-3 z-[100]">
        {attachedFiles.length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar p-2.5 bg-white/5 backdrop-blur-3xl rounded-[30px] border border-white/10 animate-in slide-in-from-bottom-4 duration-300">
            {attachedFiles.map((file, i) => ( <AttachmentPreview key={i} attachment={file} onRemove={() => removeAttachment(i)} /> ))}
          </div>
        )}
        <footer className="relative flex items-center gap-3 p-2 rounded-full shadow-[0_15px_35px_rgba(0,0,0,0.4)] transition-all group" style={glassStyles}>
          <label className="p-3.5 hover:bg-white/10 rounded-full cursor-pointer transition-all active:scale-90 flex items-center justify-center">
            <input type="file" className="hidden" multiple accept="image/*,video/*,audio/*,.pdf,.txt" onChange={e => handleFiles(e.target.files)} />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
          </label>
          <input type="text" placeholder={`Bisikin ${config.name}...`} className="flex-1 bg-transparent outline-none py-3.5 text-xs md:text-sm font-semibold text-white placeholder:text-white/20" value={inputText} onChange={e => setInputText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSend()} />
          <button onClick={() => handleSend()} disabled={(!inputText.trim() && attachedFiles.length === 0) || isTyping} className="p-3.5 bg-gradient-to-br from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 rounded-full transition-all active:scale-95 disabled:opacity-20 shadow-lg shadow-pink-500/20 border border-white/10 flex items-center justify-center mr-0.5"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white translate-x-0.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg></button>
        </footer>
      </div>

      {showProfilePreview && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/90 backdrop-blur-3xl animate-in fade-in duration-300" onClick={() => setShowProfilePreview(false)}>
          <div className="relative max-w-lg w-full aspect-square animate-in zoom-in fade-in duration-500" onClick={e => e.stopPropagation()}>
            <img src={config.profilePic || ''} className="w-full h-full object-cover rounded-[60px] shadow-2xl border-4 border-white/10" alt="Profile Full" />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-3 w-full px-6 justify-center flex-wrap">
               <label className="bg-pink-600/80 backdrop-blur-xl px-5 py-3 rounded-[25px] cursor-pointer hover:scale-110 active:scale-95 transition-all shadow-2xl border border-white/20 text-white flex items-center gap-3">
                 <input type="file" className="hidden" accept="image/*" onChange={handleProfileUpload} />
                 <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                 <span className="text-[9px] font-black uppercase tracking-widest whitespace-nowrap">Ganti Foto</span>
               </label>
               <button onClick={() => downloadMedia(config.profilePic || '', `${getSafeAgentName()}_profile.png`, 'image/png')} className="bg-white/10 backdrop-blur-xl px-5 py-3 rounded-[25px] hover:bg-white hover:text-black transition-all active:scale-95 shadow-2xl border border-white/20 text-white/80 flex items-center gap-3">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg>
                 <span className="text-[9px] font-black uppercase tracking-widest whitespace-nowrap">Simpan</span>
               </button>
               <button onClick={() => { setConfig({ ...config, profilePic: defaultProfilePic }); setShowProfilePreview(false); }} className="bg-white/5 backdrop-blur-xl px-5 py-3 rounded-[25px] hover:bg-red-500/80 transition-all active:scale-95 shadow-2xl border border-white/10 text-white/40 flex items-center gap-3">
                 <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                 <span className="text-[9px] font-black uppercase tracking-widest whitespace-nowrap">Reset</span>
               </button>
            </div>
            <button onClick={() => setShowProfilePreview(false)} className="absolute top-6 right-6 bg-white/10 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-2xl hover:bg-white hover:text-black transition-all border border-white/20"><svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        </div>
      )}

      {previewMedia && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/95 backdrop-blur-3xl animate-in fade-in duration-300" onClick={() => setPreviewMedia(null)}>
          <div className="relative max-w-4xl w-full flex flex-col items-center gap-6 animate-in zoom-in duration-500" onClick={e => e.stopPropagation()}>
            <div className="w-full flex justify-between items-center bg-white/5 backdrop-blur-xl px-6 py-4 rounded-[25px] border border-white/10 shadow-2xl">
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-white/60 truncate">{previewMedia.name}</p>
              <div className="flex gap-2">
                <button onClick={() => downloadMedia(previewMedia.data, previewMedia.name, previewMedia.mimeType)} className="p-2.5 bg-pink-600 hover:bg-pink-500 rounded-xl text-white transition-all active:scale-90 border border-white/10 shadow-lg" title="Download File">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0L8 8m4-4v12" /></svg>
                </button>
                <button onClick={() => setPreviewMedia(null)} className="p-2.5 bg-white/10 hover:bg-red-500 rounded-xl text-white transition-all active:scale-90 border border-white/10"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
            </div>
            <div className="w-full rounded-[40px] overflow-hidden border border-white/10 shadow-2xl bg-black/40 flex items-center justify-center">
               {previewMedia.mimeType.startsWith('image/') ? ( <img src={previewMedia.data} className="w-full h-auto max-h-[70vh] object-contain" /> ) : (
                 <div className="flex flex-col items-center gap-6 p-20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    <button onClick={() => downloadMedia(previewMedia.data, previewMedia.name, previewMedia.mimeType)} className="px-10 py-4 bg-white text-black font-black rounded-full uppercase text-[11px] tracking-widest hover:scale-110 transition-all shadow-2xl">Download File</button>
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
