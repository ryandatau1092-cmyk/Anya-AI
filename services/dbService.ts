
import { AgentConfig, ChatMessage, ChatSession, CallHistory } from '../types';

const DB_NAME = 'AnyaAIDatabase';
const DB_VERSION = 1;

export class DBService {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB Error:', request.error);
        reject('Gagal membuka IndexedDB');
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const stores = ['settings', 'messages', 'sessions', 'history'];
        stores.forEach(store => {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        });
      };
    });
  }

  private async get<T>(storeName: string, key: string): Promise<T | null> {
    await this.init();
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  private async set(storeName: string, key: string, value: any): Promise<void> {
    await this.init();
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db!.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  // API Methods
  async getConfig(): Promise<AgentConfig | null> { return this.get<AgentConfig>('settings', 'config'); }
  async saveConfig(config: AgentConfig): Promise<void> { return this.set('settings', 'config', config); }

  async getMessages(): Promise<ChatMessage[]> { return (await this.get<ChatMessage[]>('messages', 'list')) || []; }
  async saveMessages(messages: ChatMessage[]): Promise<void> { return this.set('messages', 'list', messages); }
  
  async getActiveMessageId(): Promise<string | null> { return this.get<string>('messages', 'active_id'); }
  async saveActiveMessageId(id: string | null): Promise<void> { return this.set('messages', 'active_id', id); }

  async getSessions(): Promise<ChatSession[]> { return (await this.get<ChatSession[]>('sessions', 'list')) || []; }
  async saveSessions(sessions: ChatSession[]): Promise<void> { return this.set('sessions', 'list', sessions); }

  async getCallHistory(): Promise<CallHistory[]> { return (await this.get<CallHistory[]>('history', 'list')) || []; }
  async saveCallHistory(history: CallHistory[]): Promise<void> { return this.set('history', 'list', history); }

  async clearAll(): Promise<void> {
    await this.init();
    const stores = ['settings', 'messages', 'sessions', 'history'];
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(stores, 'readwrite');
      stores.forEach(s => transaction.objectStore(s).clear());
      transaction.oncomplete = () => resolve();
    });
  }
}

export const dbService = new DBService();
