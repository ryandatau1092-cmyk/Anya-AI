
export interface AgentConfig {
  name: string;
  personality: string;
  voice: string;
  profilePic: string | null;
  background: string;
  blur: number;
  transparency: number;
}

export interface Attachment {
  name: string;
  mimeType: string;
  data: string; // Menyimpan base64 data (termasuk header data:...)
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  image?: string; // Untuk backward compatibility
  attachments?: Attachment[]; // Array untuk berbagai jenis file
  audio?: string; // Menyimpan base64 audio data untuk TTS
  timestamp: number;
  parentId?: string | null;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  activeMessageId: string | null;
  timestamp: number;
}

export interface CallHistory {
  id: string;
  timestamp: number;
  duration: string;
  status: 'missed' | 'completed';
}

export enum AppState {
  SETUP = 'setup',
  CHAT = 'chat',
  CALL = 'call'
}