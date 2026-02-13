import React, { useState, useEffect, useMemo } from 'react';
import { AgentConfig, AppState, ChatMessage, CallHistory, ChatSession } from './types';
import SetupView from './components/SetupView';
import ChatView from './components/ChatView';
import CallView from './components/CallView';
import Sidebar from './components/Sidebar';
import { dbService } from './services/dbService';

const ANYA_DEFAULT_PIC = 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?auto=format&fit=crop&q=80&w=600';
const DEFAULT_BG = 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=600';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.SETUP);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [callHistory, setCallHistory] = useState<CallHistory[]>([]);
  const [isDbReady, setIsDbReady] = useState(false);

  const [config, setConfig] = useState<AgentConfig>({
    name: 'Anya',
    personality: 'Gue bestie lo yang paling asik, santai, tapi perhatian banget. Gaya ngomong gue Jakarta banget (Gue/Lo). Seru diajak ngobrol apa aja deh!',
    voice: 'Kore',
    profilePic: ANYA_DEFAULT_PIC,
    background: DEFAULT_BG,
    blur: 15,
    transparency: 40
  });

  const activeThread = useMemo(() => {
    if (!activeMessageId) return [];
    const thread: ChatMessage[] = [];
    let currentId: string | null | undefined = activeMessageId;
    
    while (currentId) {
      const msg = messages.find(m => m.id === currentId);
      if (msg) {
        thread.unshift(msg);
        currentId = msg.parentId;
      } else {
        currentId = null;
      }
    }
    return thread;
  }, [activeMessageId, messages]);

  // INITIALIZATION & MIGRATION
  useEffect(() => {
    const initApp = async () => {
      try {
        await dbService.init();

        // 1. Cek Migrasi dari LocalStorage (jika user punya data lama)
        const oldConfig = localStorage.getItem('anya_config');
        const oldMessages = localStorage.getItem('anya_messages');
        const oldActiveId = localStorage.getItem('anya_active_id');
        const oldSessions = localStorage.getItem('anya_sessions');
        const oldHistory = localStorage.getItem('anya_history');

        if (oldConfig || oldMessages || oldSessions || oldHistory) {
          console.log("Migrasi data ke IndexedDB dimulai...");
          if (oldConfig) await dbService.saveConfig(JSON.parse(oldConfig));
          if (oldMessages) await dbService.saveMessages(JSON.parse(oldMessages));
          if (oldActiveId) await dbService.saveActiveMessageId(oldActiveId);
          if (oldSessions) await dbService.saveSessions(JSON.parse(oldSessions));
          if (oldHistory) await dbService.saveCallHistory(JSON.parse(oldHistory));
          
          // Hapus data lama agar tidak duplikat dan memberatkan browser
          const keysToRemove = ['anya_config', 'anya_messages', 'anya_active_id', 'anya_sessions', 'anya_history'];
          keysToRemove.forEach(k => localStorage.removeItem(k));
        }

        // 2. Load data dari IndexedDB ke State
        const [savedConfig, savedMessages, savedActiveId, savedSessions, savedHistory] = await Promise.all([
          dbService.getConfig(),
          dbService.getMessages(),
          dbService.getActiveMessageId(),
          dbService.getSessions(),
          dbService.getCallHistory()
        ]);

        if (savedConfig) setConfig(savedConfig);
        if (savedMessages) setMessages(savedMessages);
        if (savedActiveId) setActiveMessageId(savedActiveId);
        if (savedSessions) setSessions(savedSessions);
        if (savedHistory) setCallHistory(savedHistory);

        // Jika sudah ada pesan, langsung masuk ke ChatView
        if (savedMessages && savedMessages.length > 0) {
          setAppState(AppState.CHAT);
        }

        setIsDbReady(true);
      } catch (e) { 
        console.error("Database Error:", e);
        setIsDbReady(true); 
      }
    };
    initApp();
  }, []);

  // AUTO-SAVE (Berjalan di background saat state berubah)
  useEffect(() => { if (isDbReady) dbService.saveConfig(config); }, [config, isDbReady]);
  useEffect(() => { if (isDbReady) dbService.saveMessages(messages); }, [messages, isDbReady]);
  useEffect(() => { if (isDbReady) dbService.saveActiveMessageId(activeMessageId); }, [activeMessageId, isDbReady]);
  useEffect(() => { if (isDbReady) dbService.saveSessions(sessions); }, [sessions, isDbReady]);
  useEffect(() => { if (isDbReady) dbService.saveCallHistory(callHistory); }, [callHistory, isDbReady]);

  const archiveCurrentSession = () => {
    if (messages.length > 0) {
      const firstMsg = messages.find(m => !m.parentId);
      const title = firstMsg ? (firstMsg.text.substring(0, 35) + (firstMsg.text.length > 35 ? '...' : '')) : "Obrolan Baru";
      const newSession: ChatSession = {
        id: Date.now().toString(),
        title,
        messages: [...messages],
        activeMessageId: activeMessageId,
        timestamp: Date.now()
      };
      setSessions(prev => [newSession, ...prev]);
    }
  };

  const startNewChat = () => {
    archiveCurrentSession();
    setMessages([]);
    setActiveMessageId(null);
    setIsSidebarOpen(false);
  };

  const loadSession = (session: ChatSession) => {
    archiveCurrentSession(); 
    setMessages(session.messages);
    setActiveMessageId(session.activeMessageId);
    setSessions(prev => prev.filter(s => s.id !== session.id));
    setIsSidebarOpen(false);
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  };

  const clearAllSessions = async () => {
    setMessages([]);
    setActiveMessageId(null);
    setSessions([]);
    setIsSidebarOpen(false);
    setAppState(AppState.SETUP);
  };

  const deleteCall = (id: string) => {
    setCallHistory(prev => prev.filter(c => c.id !== id));
  };

  const clearAllCalls = () => {
    setCallHistory([]);
  };

  const resetAll = async () => {
    const confirm = window.confirm("Ini bakal hapus SEMUA memori, settingan, dan riwayat chat. Yakin?");
    if (!confirm) return;
    await dbService.clearAll();
    localStorage.clear();
    window.location.reload();
  };

  if (!isDbReady) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-pink-500/10 border-t-pink-500 rounded-full animate-spin"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-2 h-2 bg-pink-500 rounded-full animate-ping"></div>
          </div>
        </div>
        <div className="text-center">
          <p className="text-pink-500 font-black uppercase text-[10px] tracking-[0.5em] animate-pulse">Menghubungkan Database...</p>
          <p className="text-white/20 text-[8px] mt-2 font-bold uppercase tracking-widest">Optimizing Memory Storage</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col items-center justify-center">
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-700"
        style={{ backgroundImage: `url(${config.background})` }}
      >
        <div className="absolute inset-0 bg-black" style={{ opacity: config.transparency / 100 }} />
        <div className="absolute inset-0 backdrop-blur-md" style={{ backdropFilter: `blur(${config.blur}px)` }} />
      </div>

      <Sidebar 
        isOpen={isSidebarOpen} 
        onClose={() => setIsSidebarOpen(false)} 
        messages={activeThread}
        sessions={sessions}
        history={callHistory}
        onNewChat={startNewChat}
        onLoadSession={loadSession}
        onDeleteSession={deleteSession}
        onClearSessions={clearAllSessions}
        onDeleteCall={deleteCall}
        onClearCalls={clearAllCalls}
        onReset={resetAll}
      />

      <main className="relative z-10 w-full h-full flex flex-col items-center justify-center overflow-hidden">
        {appState === AppState.SETUP && (
          <SetupView 
            config={config} 
            setConfig={setConfig} 
            onStart={() => setAppState(AppState.CHAT)} 
            onReset={resetAll} 
            onClose={messages.length > 0 ? () => setAppState(AppState.CHAT) : undefined}
          />
        )}
        {appState === AppState.CHAT && (
          <ChatView 
            config={config} 
            setConfig={setConfig}
            messages={messages}
            setMessages={setMessages}
            activeMessageId={activeMessageId}
            setActiveMessageId={setActiveMessageId}
            activeThread={activeThread}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onCall={() => setAppState(AppState.CALL)}
            onEdit={() => setAppState(AppState.SETUP)}
            defaultProfilePic={ANYA_DEFAULT_PIC}
          />
        )}
        {appState === AppState.CALL && (
          <CallView 
            config={config}
            onEndCall={(duration) => {
              if (duration !== "0:00") {
                setCallHistory(prev => [{ id: Date.now().toString(), timestamp: Date.now(), duration, status: 'completed' }, ...prev]);
              }
              setAppState(AppState.CHAT);
            }}
          />
        )}
      </main>
    </div>
  );
};

export default App;