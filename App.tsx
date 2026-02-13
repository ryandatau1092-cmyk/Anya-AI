
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

  useEffect(() => {
    const initApp = async () => {
      try {
        await dbService.init();
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

  const clearAllSessions = async () => {
    setMessages([]);
    setActiveMessageId(null);
    setSessions([]);
    setIsSidebarOpen(false);
    setAppState(AppState.SETUP);
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
      <div className="h-[100dvh] w-full bg-black flex flex-col items-center justify-center gap-6 animate-in fade-in duration-1000">
        <div className="w-16 h-16 border-4 border-pink-500/10 border-t-pink-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden flex flex-col items-center justify-start">
      <div 
        className="absolute inset-0 z-0 bg-cover bg-center transition-all duration-1000"
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
        onDeleteSession={(id) => setSessions(prev => prev.filter(s => s.id !== id))}
        onClearSessions={clearAllSessions}
        onDeleteCall={(id) => setCallHistory(prev => prev.filter(c => c.id !== id))}
        onClearCalls={() => setCallHistory([])}
        onReset={resetAll}
      />

      <main className="relative z-10 w-full h-full flex flex-col items-center justify-start overflow-hidden transition-all duration-500">
        {appState === AppState.SETUP && (
          <div className="w-full h-full flex items-center justify-center p-2">
            <SetupView 
              config={config} 
              setConfig={setConfig} 
              onStart={() => setAppState(AppState.CHAT)} 
              onReset={resetAll} 
              defaultProfilePic={ANYA_DEFAULT_PIC}
              onClose={messages.length > 0 ? () => setAppState(AppState.CHAT) : undefined}
            />
          </div>
        )}
        {appState === AppState.CHAT && (
          <div className="w-full h-full">
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
          </div>
        )}
        {appState === AppState.CALL && (
          <div className="w-full h-full">
            <CallView 
              config={config}
              onEndCall={(duration) => {
                if (duration !== "0:00") setCallHistory(prev => [{ id: Date.now().toString(), timestamp: Date.now(), duration, status: 'completed' }, ...prev]);
                setAppState(AppState.CHAT);
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
