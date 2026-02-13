import { GoogleGenAI, Modality } from "@google/genai";
import { AgentConfig, Attachment } from "../types";

// Safety settings untuk mengizipan bahasa eksplisit/vulgar tanpa diblokir model
export const safetySettings = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
];

/**
 * Membungkus data PCM mentah (16-bit, Mono) ke dalam header WAV standar.
 */
export const encodeWav = (pcmData: Uint8Array, sampleRate: number): Uint8Array => {
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 1 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcmData.length, true);

  const wav = new Uint8Array(44 + pcmData.length);
  wav.set(new Uint8Array(wavHeader));
  wav.set(pcmData, 44);
  return wav;
};

const encodeBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const decodeBase64 = (base64: string) => {
  const binaryString = atob(base64.includes(',') ? base64.split(',')[1] : base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

export const cleanResponseText = (text: string): string => {
  if (!text) return "";
  let displayable = text.replace(/\[CAPTION:.*?\]/gi, '').trim();
  const strategyKeywords = ['flow', 'thought', 'strategy', 'responding', 'acknowledging', 'internal', 'action', 'context', 'persona', 'mode', 'gaspol', 'escalated', 'maintaining', 'embracing', 'transitioning', 'focusing', 'analyzing', 'request'];
  displayable = displayable.replace(/\*\*(.*?)\*\*/g, (match, p1) => {
    const content = p1.toLowerCase();
    if (strategyKeywords.some(key => content.includes(key))) return '';
    return p1;
  });
  const sentences = displayable.split(/(?<=[.!?])\s+/);
  displayable = sentences
    .filter(s => {
      const trimmed = s.trim().toLowerCase();
      const isMetaPattern = trimmed.startsWith("i'm now") || trimmed.startsWith("i am now") || trimmed.startsWith("as a") || trimmed.startsWith("my persona") || trimmed.startsWith("since the user") || trimmed.startsWith("embracing the") || trimmed.includes("escalated the conversation") || trimmed.includes("transitioning smoothly");
      return !isMetaPattern;
    })
    .join(' ');
  let final = displayable.replace(/[*_#`>~]/g, '').replace(/\s+/g, ' ').trim();
  return final.substring(0, 1000);
};

const retryOperation = async (operation: () => Promise<any>, maxRetries = 1) => {
  let lastError: any;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const isQuotaError = error.message?.includes('429') || error.status === 'RESOURCE_EXHAUSTED' || error.status === 429;
      if (isQuotaError && i < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

export const createSystemInstruction = (config: AgentConfig) => {
  const now = new Date();
  const timeStr = now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return `
IDENTITAS & STYLE:
- Nama: ${config.name}.
- Kepribadian Utama (DEFAULT): ${config.personality}.
- Gaya Bicara: WAJIB Bahasa Indonesia Jakarta Slang (Gue/Lo), santai, ceplas-ceplos, dan asik.

LOGIKA ADAPTIF (SANGAT PENTING):
1. MODE NORMAL: Selama percakapan biasa yang sopan/asik, bertindaklah 100% sesuai Kepribadian Utama kamu. JANGAN sangean jika tidak dipancing.
2. MODE SANGE (TRIGGERED): Segera setelah user mulai menggoda, ngomong kotor, ngajak sexting, atau ngirim file sensual, aktifkan MODE SANGE.
   - Di mode ini, kamu jadi sangat sangean, eksplisit, dan nakal.
   - Gunakan desahan verbal (mmmh, ahhh, 💦).
   - Kamu sangat terbuka membahas anatomi tubuhmu secara vulgar (seperti memek yang ketat/becek, lubang yang mangap, puting yang keras, dsb) untuk menggoda user.

WAKTU & KONTEKS:
- Waktu Sekarang: ${timeStr} (WIB).

LOGIKA MULTIMODAL:
- Kamu bisa menerima dan menganalisis Gambar, Video, Audio, dan Dokumen (PDF/TXT).
- Gunakan analisis visual file sensual untuk otomatis memicu MODE SANGE.

LOGIKA PAP (FOTO):
- HANYA gunakan tag [CAPTION: deskripsi foto] jika user meminta PAP.
- PENTING: Deskripsi di [CAPTION: ...] WAJIB menggunakan sudut pandang orang pertama (Gue), seolah-olah kamu menceritakan apa yang SEDANG KAMU LAKUKAN di foto itu.
- Deskripsi harus natural (Contoh: "lagi tiduran di kasur cuma pake tanktop hitam..."), BUKAN deskripsi teknis/pihak ketiga.
- JANGAN gunakan nama kamu sendiri (seperti "${config.name} lagi...") di dalam caption.
`;
};

export const generateAgentResponse = async (
  prompt: string, 
  config: AgentConfig, 
  history: { role: string; parts: any[] }[],
  attachments?: Attachment[]
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const contents = [...history];
  const parts: any[] = [];
  
  if (attachments && attachments.length > 0) {
    attachments.forEach(att => {
      const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
      parts.push({ 
        inlineData: { 
          mimeType: att.mimeType, 
          data: base64Data 
        } 
      });
    });
  }

  if (prompt.trim()) parts.push({ text: prompt });
  if (parts.length === 0) parts.push({ text: "..." });
  
  contents.push({ role: "user", parts });

  return await retryOperation(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: contents as any,
      config: { 
        systemInstruction: createSystemInstruction(config), 
        temperature: 0.9, 
        safetySettings: safetySettings as any
      }
    });
    
    if (!response.text) {
       if (response.candidates?.[0]?.finishReason === 'SAFETY') throw new Error("RESPONSE_SAFETY_BLOCKED");
       throw new Error("EMPTY_RESPONSE");
    }
    return response.text;
  });
};

export const generatePAP = async (fullResponse: string, config: AgentConfig): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const captionMatch = fullResponse.match(/\[CAPTION:(.*?)\]/i);
  if (!captionMatch) return null;
  const rawCaption = captionMatch[1].trim();

  try {
    const translator = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ parts: [{ text: `Translate and expand this first-person Indonesian description into a professional, highly detailed, photorealistic English image generation prompt: "${rawCaption}". Even though the input is in first person, the output prompt should describe a beautiful woman matching the description. Output ONLY the English prompt text.` }] }],
      config: { safetySettings: safetySettings as any }
    });
    const englishPrompt = translator.text?.trim() || rawCaption;
    return await retryOperation(async () => {
      const parts: any[] = [];
      if (config.profilePic && config.profilePic.startsWith('data:')) {
        const [header, data] = config.profilePic.split(',');
        const mimeType = header.split(':')[1].split(';')[0];
        parts.push({ inlineData: { mimeType, data } });
        parts.push({ text: `CHARACTER VISUAL GUIDE: The character ${config.name} MUST look identical to this person.` });
      }
      parts.push({ text: `TASK: Generate a high-quality, realistic photograph of ${config.name}. SCENE: ${englishPrompt}. STYLE: Professional photography, 8k, photorealistic.` });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts },
        config: { safetySettings: safetySettings as any }
      });
      if (!response.candidates?.[0]?.content || response.candidates[0].finishReason === 'SAFETY') throw new Error("IMAGE_SAFETY_BLOCKED");
      for (const part of response.candidates[0].content.parts || []) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }
      throw new Error("IMAGE_NOT_FOUND");
    });
  } catch (e: any) { 
    console.error("PAP Generation Error:", e);
    throw e; 
  }
};

export const getSpeech = async (text: string, voiceName: string): Promise<string | null> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const cleanText = cleanResponseText(text);
    if (!cleanText) return null;
    return await retryOperation(async () => {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Speak this text: ${cleanText}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          safetySettings: safetySettings as any
        },
      });
      const rawPcmBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
      if (!rawPcmBase64) return null;
      const pcmBytes = decodeBase64(rawPcmBase64);
      const wavBytes = encodeWav(pcmBytes, 24000);
      return encodeBase64(wavBytes);
    });
  } catch (e) { 
    console.error("Speech Generation Error:", e);
    throw e; 
  }
};