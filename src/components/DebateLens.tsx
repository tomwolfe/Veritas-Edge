'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioProcessor } from '@/hooks/useAudioProcessor';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, CheckCircle2, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Transcript {
  id: string;
  text: string;
  speaker: 'A' | 'B';
  isChecking: boolean;
  factCheck?: {
    verdict: 'True' | 'False' | 'Unverified' | 'NOT_A_CLAIM';
    explanation: string;
  };
}

export default function DebateLens() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<'A' | 'B'>('A');
  const [worker, setWorker] = useState<Worker | null>(null);
  const [status, setStatus] = useState<'initializing' | 'loading' | 'ready' | 'error'>('initializing');
  const [progress, setProgress] = useState<{ stt: number; llm: number }>({ stt: 0, llm: 0 });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../workers/inference.worker.ts', import.meta.url), {
        type: 'module'
    });
    
    w.onmessage = (e) => {
      const { status, message, progress: p, model, text, result, id, error } = e.data;

      if (status === 'loading') setStatus('loading');
      if (status === 'ready') setStatus('ready');
      if (status === 'error') {
        setStatus('error');
        console.error(error);
      }
      if (status === 'progress') {
        setProgress(prev => ({ ...prev, [model]: p.progress }));
      }
      if (status === 'transcription') {
        handleTranscription(text, id);
      }
      if (status === 'fact-check-result') {
        handleFactCheckResult(result, id);
      }
    };

    w.postMessage({ type: 'load' });
    workerRef.current = w;
    setWorker(w);

    return () => w.terminate();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '1') setActiveSpeaker('A');
      if (e.key === '2') setActiveSpeaker('B');
      if (e.key === 'c' && e.ctrlKey) setTranscripts([]);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const clearFeed = () => setTranscripts([]);

  const handleTranscription = useCallback((text: string, id: string) => {
    if (text.trim().length < 10) return; // Ignore short fragments

    setTranscripts(prev => [
      ...prev,
      {
        id,
        text,
        speaker: activeSpeaker,
        isChecking: true,
      }
    ]);

    workerRef.current?.postMessage({
      type: 'fact-check',
      data: { text, id }
    });
  }, [activeSpeaker]);

  const handleFactCheckResult = useCallback((result: string, id: string) => {
    setTranscripts(prev => prev.map(t => {
      if (t.id === id) {
        if (result.includes('NOT_A_CLAIM')) {
          return { ...t, isChecking: false, factCheck: { verdict: 'NOT_A_CLAIM', explanation: '' } };
        }
        
        let verdict: 'True' | 'False' | 'Unverified' = 'Unverified';
        if (result.toLowerCase().includes('true')) verdict = 'True';
        else if (result.toLowerCase().includes('false')) verdict = 'False';

        const explanation = result.split('\n').pop() || result;

        return {
          ...t,
          isChecking: false,
          factCheck: { verdict, explanation }
        };
      }
      return t;
    }));
  }, []);

  const onSpeechEnd = useCallback((audio: Float32Array) => {
    const id = Math.random().toString(36).substring(7);
    workerRef.current?.postMessage({
      type: 'transcribe',
      data: { audio, id }
    });
  }, []);

  const { vad } = useAudioProcessor(onSpeechEnd);

  if (status === 'initializing' || status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-8">
        <Loader2 className="w-12 h-12 animate-spin mb-4 text-blue-500" />
        <h1 className="text-2xl font-bold mb-8 text-center">Initializing DebateLens</h1>
        
        <div className="w-full max-w-md space-y-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Whisper STT</span>
              <span>{Math.round(progress.stt || 0)}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <motion.div 
                className="bg-blue-500 h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress.stt || 0}%` }}
              />
            </div>
          </div>
          
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Phi-3 Fact-Checker</span>
              <span>{Math.round(progress.llm || 0)}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <motion.div 
                className="bg-purple-500 h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress.llm || 0}%` }}
              />
            </div>
          </div>
        </div>
        <p className="mt-8 text-slate-400 text-sm italic">WebGPU required. Loading ~2.5GB of models.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <h1 className="font-bold text-xl tracking-tight">DEBATE<span className="text-blue-500">LENS</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 rounded-lg p-1">
            <button 
              onClick={() => setActiveSpeaker('A')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                activeSpeaker === 'A' ? "bg-blue-600 text-white shadow-lg" : "text-slate-400 hover:text-white"
              )}
            >
              Speaker A
            </button>
            <button 
              onClick={() => setActiveSpeaker('B')}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                activeSpeaker === 'B' ? "bg-red-600 text-white shadow-lg" : "text-slate-400 hover:text-white"
              )}
            >
              Speaker B
            </button>
          </div>
          
          <button 
            onClick={clearFeed}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors"
            title="Clear Feed (Ctrl+C)"
          >
            <XCircle className="w-5 h-5" />
          </button>

          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm",
            vad.userSpeaking ? "border-green-500/50 bg-green-500/10 text-green-400" : "border-slate-700 bg-slate-800 text-slate-400"
          )}>
            {vad.userSpeaking ? <Mic className="w-4 h-4 animate-bounce" /> : <MicOff className="w-4 h-4" />}
            {vad.userSpeaking ? "Speaking..." : "Listening..."}
          </div>
        </div>
      </header>

      {/* Main Feed */}
      <main className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
        <AnimatePresence mode="popLayout">
          {transcripts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cn(
                "flex flex-col max-w-[80%] space-y-2",
                t.speaker === 'A' ? "self-start" : "self-end items-end"
              )}
            >
              <div className={cn(
                "px-4 py-3 rounded-2xl text-lg shadow-xl transition-all duration-500",
                t.speaker === 'A' 
                  ? "bg-slate-800 rounded-tl-none border-l-4 border-blue-500" 
                  : "bg-slate-800 rounded-tr-none border-r-4 border-red-500 text-right",
                t.isChecking && (t.speaker === 'A' ? "shadow-[0_0_20px_rgba(59,130,246,0.3)]" : "shadow-[0_0_20px_rgba(239,68,68,0.3)]")
              )}>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 block">
                  Speaker {t.speaker}
                </span>
                {t.text}
              </div>

              {t.isChecking && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-xs text-blue-400 italic"
                >
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Fact-checking claim...
                </motion.div>
              )}

              {t.factCheck && t.factCheck.verdict !== 'NOT_A_CLAIM' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className={cn(
                    "p-3 rounded-xl border text-sm w-full",
                    t.factCheck.verdict === 'True' && "bg-green-500/10 border-green-500/50 text-green-200",
                    t.factCheck.verdict === 'False' && "bg-red-500/10 border-red-500/50 text-red-200",
                    t.factCheck.verdict === 'Unverified' && "bg-yellow-500/10 border-yellow-500/50 text-yellow-200"
                  )}
                >
                  <div className="flex items-center gap-2 font-bold mb-1">
                    {t.factCheck.verdict === 'True' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {t.factCheck.verdict === 'False' && <XCircle className="w-4 h-4 text-red-500" />}
                    {t.factCheck.verdict === 'Unverified' && <AlertCircle className="w-4 h-4 text-yellow-500" />}
                    {t.factCheck.verdict}
                  </div>
                  {t.factCheck.explanation}
                </motion.div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {transcripts.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4 opacity-50">
            <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center">
              <Mic className="w-8 h-8" />
            </div>
            <p>Start speaking to see real-time fact-checking</p>
          </div>
        )}
      </main>

      {/* Footer / Info */}
      <footer className="p-2 text-[10px] text-center text-slate-600 uppercase tracking-widest border-t border-slate-900">
        Powered by Transformers.js v3 (WebGPU) • Whisper-Tiny • Phi-3 Mini
      </footer>
    </div>
  );
}
