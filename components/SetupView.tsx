
import React, { useState, useRef } from 'react';
import { AgentConfig } from '../types';

interface SetupViewProps {
  config: AgentConfig;
  setConfig: (config: AgentConfig) => void;
  onStart: () => void;
  onReset: () => void;
  defaultProfilePic: string;
  onClose?: () => void;
}

const SetupView: React.FC<SetupViewProps> = ({ config, setConfig, onStart, onReset, defaultProfilePic, onClose }) => {
  const [isDragging, setIsDragging] = useState(false);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setConfig({ ...config, profilePic: reader.result as string });
      reader.readAsDataURL(file);
    }
  };

  const handleBgFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setConfig({ ...config, background: reader.result as string });
      reader.readAsDataURL(file);
    }
  };

  const bgOptions = [
    { id: 12, url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=600' },
    { id: 10, url: 'https://images.unsplash.com/photo-1513519245088-0e12902e5a38?q=80&w=600' },
    { id: 11, url: 'https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=600' },
    { id: 13, url: 'https://images.unsplash.com/photo-1501691223387-dd0500403074?q=80&w=600' }
  ];

  const glassOpacity = Math.max(0.1, config.transparency / 100);

  return (
    <div className="w-full max-w-4xl p-1 shadow-2xl animate-in fade-in zoom-in duration-500 overflow-y-auto max-h-[100dvh] custom-scrollbar">
      <div 
        className="border border-white/20 rounded-[40px] md:rounded-[50px] p-6 md:p-10 shadow-2xl transition-all duration-300 relative m-2"
        style={{ 
          backgroundColor: `rgba(0, 0, 0, ${glassOpacity})`,
          backdropFilter: `blur(${config.blur}px)`,
          WebkitBackdropFilter: `blur(${config.blur}px)`
        }}
      >
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 md:top-8 md:right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full transition-all border border-white/10 text-white/40 hover:text-white z-20">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}

        <header className="text-center mb-8">
          <h1 className="text-2xl md:text-4xl font-black tracking-tighter text-white drop-shadow-lg uppercase">Agen Setup</h1>
          <p className="text-pink-500 font-bold uppercase text-[9px] md:text-[10px] tracking-[0.4em] mt-2 opacity-80 underline underline-offset-4">Konfigurasi Agen Kamu</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-5 bg-pink-500 rounded-full shadow-[0_0_10px_rgba(236,72,153,0.5)]"></div>
              <h2 className="text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] text-white/90">Identitas Utama</h2>
            </div>
            
            <div className="bg-white/5 border border-white/10 p-6 md:p-8 rounded-[40px] space-y-8">
              {/* PHOTO UPLOAD SECTION */}
              <div className="flex flex-col items-center gap-4">
                <label className="text-[8px] md:text-[9px] font-bold text-white/30 uppercase tracking-widest">Foto Profil Agen</label>
                <div className="relative group p-1">
                  <div className="w-32 h-32 md:w-44 md:h-44 rounded-[45px] md:rounded-[55px] overflow-hidden border-4 border-white/20 group-hover:border-pink-500/50 transition-all duration-500 shadow-2xl bg-black/40">
                    <img src={config.profilePic || defaultProfilePic} alt="Profile" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute -bottom-2 -right-2 flex flex-col gap-2">
                    <label className="bg-pink-600 p-3.5 rounded-2xl cursor-pointer hover:scale-110 active:scale-95 transition-all shadow-xl border-2 border-black/20 hover:bg-pink-500">
                      <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                    </label>
                    <button onClick={() => setConfig({ ...config, profilePic: defaultProfilePic })} className="bg-white/10 backdrop-blur-md p-3 rounded-2xl cursor-pointer hover:scale-110 active:scale-95 transition-all shadow-xl border border-white/20 text-white/60 hover:text-white" title="Reset ke Default">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[8px] md:text-[9px] font-bold text-white/30 uppercase tracking-widest ml-4">Nama Agen</label>
                  <input type="text" className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 outline-none focus:ring-2 ring-pink-500/40 font-black transition-all text-white text-base md:text-lg" value={config.name} onChange={(e) => setConfig({ ...config, name: e.target.value })} placeholder="Nama Agen..." />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[8px] md:text-[9px] font-bold text-white/30 uppercase tracking-widest ml-4">Personality</label>
                  <textarea className="w-full h-24 bg-black/30 border border-white/10 rounded-[25px] px-5 py-4 outline-none focus:ring-2 ring-pink-500/40 resize-none text-xs md:text-sm font-medium leading-relaxed custom-scrollbar text-white/80" value={config.personality} onChange={(e) => setConfig({ ...config, personality: e.target.value })} placeholder="Gue asik, suka gibah..." />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
             <div className="flex items-center gap-3">
              <div className="w-1.5 h-5 bg-purple-500 rounded-full shadow-[0_0_10px_rgba(168,85,247,0.5)]"></div>
              <h2 className="text-[10px] md:text-[11px] font-black uppercase tracking-[0.2em] text-white/90">Suara & Tema</h2>
            </div>

            <div className="bg-white/5 border border-white/10 p-6 md:p-8 rounded-[40px] space-y-6 shadow-inner">
              <div className="space-y-1.5">
                <label className="text-[8px] md:text-[9px] font-bold text-white/30 uppercase tracking-widest ml-4">Karakter Suara</label>
                <select className="w-full bg-black/40 border border-white/10 rounded-2xl px-5 py-4 outline-none font-bold text-white shadow-lg text-xs md:text-sm appearance-none" value={config.voice} onChange={(e) => setConfig({ ...config, voice: e.target.value })}>
                  <option value="Kore">Suara Ceria (Kore)</option>
                  <option value="Puck">Suara Deep (Puck)</option>
                  <option value="Charon">Suara Elegan (Charon)</option>
                  <option value="Zephyr">Suara Ramah (Zephyr)</option>
                </select>
              </div>

              <div className="space-y-4">
                <label className="text-[8px] md:text-[9px] font-bold text-white/30 uppercase tracking-widest ml-4">Wallpaper</label>
                <div className="flex gap-3 overflow-x-auto pb-3 px-1 custom-scrollbar">
                  {bgOptions.map(bg => (
                    <button key={bg.id} onClick={() => setConfig({...config, background: bg.url})} className={`flex-shrink-0 w-20 h-20 rounded-2xl border-4 transition-all duration-500 overflow-hidden ${config.background === bg.url ? 'border-pink-500 scale-105 shadow-xl shadow-pink-500/20' : 'border-white/5 opacity-50 hover:opacity-100'}`}><img src={bg.url} className="w-full h-full object-cover" /></button>
                  ))}
                  <div className="flex-shrink-0">
                    <input type="file" className="hidden" accept="image/*" ref={bgInputRef} onChange={handleBgFile} />
                    <button onClick={() => bgInputRef.current?.click()} className="w-20 h-20 rounded-2xl border-4 border-dashed border-white/10 bg-white/5 hover:border-pink-500/40 transition-all flex flex-col items-center justify-center gap-1 group/upload text-white/20">
                      <svg className="h-6 w-6 group-hover/upload:text-pink-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" /></svg>
                      <span className="text-[7px] font-black uppercase group-hover/upload:text-pink-500 tracking-widest">Custom</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-5 px-1">
                <div className="space-y-2">
                  <div className="flex justify-between items-end"><label className="text-[8px] md:text-[9px] font-bold text-white/40 uppercase tracking-widest">Blur</label><span className="text-[10px] md:text-xs font-black text-pink-500">{config.blur}px</span></div>
                  <input type="range" min="0" max="40" className="w-full accent-pink-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer" value={config.blur} onChange={(e) => setConfig({...config, blur: parseInt(e.target.value)})} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-end"><label className="text-[8px] md:text-[9px] font-bold text-white/40 uppercase tracking-widest">Dim</label><span className="text-[10px] md:text-xs font-black text-pink-500">{config.transparency}%</span></div>
                  <input type="range" min="0" max="100" className="w-full accent-pink-500 h-1 bg-white/10 rounded-full appearance-none cursor-pointer" value={config.transparency} onChange={(e) => setConfig({...config, transparency: parseInt(e.target.value)})} />
                </div>
              </div>
            </div>

            <div className="pt-4 space-y-3">
              <button onClick={onStart} className="w-full bg-gradient-to-r from-pink-600 via-purple-600 to-pink-600 bg-[length:200%_auto] animate-gradient hover:bg-right text-white font-black py-5 md:py-6 rounded-[30px] shadow-2xl shadow-pink-500/30 active:scale-[0.98] transition-all uppercase tracking-[0.4em] text-[11px] md:text-[13px] border border-white/20">Mulai Sekarang</button>
              <button onClick={onReset} className="w-full text-[8px] font-bold uppercase tracking-[0.2em] text-white/10 hover:text-red-400 transition-colors py-1">Reset Database</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default SetupView;
