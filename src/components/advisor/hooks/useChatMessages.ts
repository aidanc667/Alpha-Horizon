'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { NearTermIntelligence, LiveBriefing } from '@/types/market';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

interface SessionCtx {
  portfolio: string;
  portfolioFindings: string;
  thesis: string;
  bestTickers: string;
  crossTabContext: string;
}

interface UseChatMessagesOptions {
  nearTermData: NearTermIntelligence | null;
  liveData: LiveBriefing | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  polygonCtx: any | null;
  sessionCtx: SessionCtx;
}

export function useChatMessages({
  nearTermData,
  liveData,
  polygonCtx,
  sessionCtx,
}: UseChatMessagesOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const sendChat = useCallback(async (text: string) => {
    if (!text.trim() || chatLoading) return;

    const userMsg: ChatMessage = { role: 'user', text };
    // Use ref — not state — so history is always current even mid-stream
    const historyForAPI = [...messagesRef.current, userMsg].map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      text: m.text,
    }));

    setMessages(prev => [...prev, userMsg, { role: 'assistant', text: '' }]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'advisorChat', history: historyForAPI, nearTermContext: nearTermData, liveContext: liveData, polygonCtx, sessionCtx }),
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', text: fullText };
          return updated;
        });
      }

      // Persist sequentially to avoid race with clear-history
      await fetch('/api/silas/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: text }) });
      await fetch('/api/silas/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'assistant', content: fullText }) });
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', text: 'Error getting response. Please try again.' };
        return updated;
      });
    } finally {
      setChatLoading(false);
    }
  }, [chatLoading, nearTermData, liveData, polygonCtx, sessionCtx]);

  return { messages, setMessages, chatInput, setChatInput, chatLoading, sendChat };
}
