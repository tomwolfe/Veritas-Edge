'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioProcessor } from '@/hooks/useAudioProcessor';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, CheckCircle2, XCircle, AlertCircle, Loader2, Copy, Trash2 } from 'lucide-react';
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
  timestamp: number;
  factCheck?: {
    verdict: 'True' | 'False' | 'Unverified' | 'NOT_A_CLAIM';
    explanation: string;
  };
}

export default function DebateLens() {
  const [transcripts, setTranscripts] = useState<Transcript[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('debatelens_transcripts');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return parsed.map((t: any) => ({ ...t, isChecking: false }));
        } catch (e) {
          console.error('Failed to parse saved transcripts', e);
        }
      }
    }
    return [];
  });
  const [activeSpeaker, setActiveSpeaker] = useState<'A' | 'B'>('A');
  const [status, setStatus] = useState<'initializing' | 'loading' | 'ready' | 'error'>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [progress, setProgress] = useState<{ stt: number; llm: number }>({ stt: 0, llm: 0 });
  const workerRef = useRef<Worker | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch available microphones
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const audioDevices = devices.filter(d => d.kind === 'audioinput');
      setDevices(audioDevices);
      if (audioDevices.length > 0) {
        setSelectedDevice(audioDevices[0].deviceId);
      }
    });
  }, []);

  const onSpeechEnd = useCallback((audio: Float32Array) => {
    const id = Math.random().toString(36).substring(7);
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'transcribe',
        data: { audio, id, speaker: activeSpeakerRef.current }
      }, [audio.buffer]);
    }
  }, []);

  const { vad } = useAudioProcessor(onSpeechEnd, selectedDevice);

  const clearFeed = useCallback(() => {
    if (confirm('Clear all transcripts?')) {
      setTranscripts([]);
      localStorage.removeItem('debatelens_transcripts');
    }
  }, []);

  const copyToClipboard = useCallback(() => {
    const text = transcripts.map(t => {
      const verdict = t.factCheck?.verdict && t.factCheck.verdict !== 'NOT_A_CLAIM' 
        ? ` [Verdict: ${t.factCheck.verdict}]` 
        : '';
      return `Speaker ${t.speaker}: ${t.text}${verdict}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text);
  }, [transcripts]);

  const activeSpeakerRef = useRef(activeSpeaker);

  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

  const handleTranscription = useCallback((text: string, id: string) => {
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount < 3) return; // Reduced word count threshold for snappiness

    const finalSpeaker = activeSpeakerRef.current;

    setTranscripts(prev => [
      ...prev,
      {
        id,
        text,
        speaker: finalSpeaker,
        isChecking: true,
        timestamp: Date.now(),
      }
    ]);

    workerRef.current?.postMessage({
      type: 'fact-check',
      data: { text, id }
    });
  }, []);

  const handleFactCheckStream = useCallback((result: string, id: string, isDone: boolean) => {
    setTranscripts(prev => prev.map(t => {
      if (t.id === id) {
        const trimmedResult = result.trim();

        if (trimmedResult.toUpperCase().includes('NOT_A_CLAIM') && trimmedResult.length < 20) {
          return {
            ...t,
            isChecking: !isDone,
            factCheck: isDone ? { verdict: 'NOT_A_CLAIM', explanation: '' } : undefined
          };
        }

        // Robust parsing during streaming
        const verdictMatch = result.match(/\[?(True|False|Unverified)\]?[:\s|]*-?\s*(.*)/i);

        if (verdictMatch) {
          const verdictStr = verdictMatch[1].toLowerCase();
          const verdict = (verdictStr.charAt(0).toUpperCase() + verdictStr.slice(1)) as 'True' | 'False' | 'Unverified';
          const explanation = verdictMatch[2].trim() || 'Analyzing...';

          return {
            ...t,
            isChecking: !isDone,
            factCheck: { verdict, explanation }
          };
        }

        // Fallback for partial/initial stream
        return {
          ...t,
          isChecking: !isDone,
          factCheck: { verdict: 'Unverified', explanation: result }
        };
      }
      return t;
    }));
  }, []);

  const handleManualSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const textarea = document.getElementById('manual-input') as HTMLTextAreaElement;
    if (textarea && textarea.value.trim()) {
      const text = textarea.value.trim();
      const wordCount = text.split(/\s+/).length;

      // Only submit if it meets the minimum word count
      if (wordCount >= 3) {
        const id = Math.random().toString(36).substring(7);

        setTranscripts(prev => [
          ...prev,
          {
            id,
            text,
            speaker: activeSpeaker,
            isChecking: true,
            timestamp: Date.now(),
          }
        ]);

        workerRef.current?.postMessage({
          type: 'fact-check',
          data: { text, id }
        });

        textarea.value = ''; // Clear the input
      }
    }
  }, [activeSpeaker]);

  // Save to localStorage
  useEffect(() => {
    if (transcripts.length > 0) {
      localStorage.setItem('debatelens_transcripts', JSON.stringify(transcripts));
    }
  }, [transcripts]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  useEffect(() => {
    const w = new Worker(new URL('../workers/inference.worker.ts', import.meta.url), {
        type: 'module'
    });

    w.onmessage = (e) => {
      const { status, progress: p, model, text, id, error, isDone } = e.data;

      if (status === 'ready') setStatus('ready');
      if (status === 'error') {
        if (id) {
          setTranscripts(prev => prev.map(t =>
            t.id === id ? { ...t, isChecking: false, factCheck: { verdict: 'Unverified', explanation: `Error: ${error}` } } : t
          ));
        } else {
          setStatus('error');
          setErrorMessage(error);
          console.error(error);
        }
      }
      if (status === 'progress') {
        setStatus('loading');
        setProgress(prev => ({ ...prev, [model]: p }));
      }
      if (status === 'transcription') {
        handleTranscription(text, id);
      }
      if (status === 'fact-check-stream') {
        handleFactCheckStream(text, id, isDone);
      }
    };

    w.postMessage({ type: 'load' });
    workerRef.current = w;

    return () => w.terminate();
  }, [handleTranscription, handleFactCheckStream]);

  const toggleListening = useCallback(() => {
    if (vad.listening) {
      vad.pause();
    } else {
      vad.start();
    }
  }, [vad]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '1') setActiveSpeaker('A');
      if (e.key === '2') setActiveSpeaker('B');
      if (e.key === 'Tab') {
        e.preventDefault();
        setActiveSpeaker(prev => prev === 'A' ? 'B' : 'A');
      }
      if (e.key === 'm') toggleListening();
      if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        clearFeed();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleListening]);

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-8">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Initialization Failed</h1>
        <p className="text-slate-400 text-center max-w-md">{errorMessage || 'An unknown error occurred while initializing WebGPU or loading models.'}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-8 px-6 py-2 bg-blue-600 rounded-lg font-bold hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (status === 'initializing' || status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-8">
        <Loader2 className="w-12 h-12 animate-spin mb-4 text-blue-500" />
        <h1 className="text-2xl font-bold mb-2 text-center text-balance tracking-tight">Initializing DebateLens</h1>
        <p className="text-slate-400 mb-8 text-sm">Preparing WebGPU environment and AI models...</p>

        <div className="w-full max-w-md space-y-4">
          <div>
            <div className="flex justify-between text-xs font-mono mb-1.5 text-slate-400">
              <span>WHISPER STT</span>
              <span>{Math.round(progress.stt || 0)}%</span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <motion.div
                className="bg-blue-500 h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress.stt || 0}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-mono mb-1.5 text-slate-400">
              <span>PHI-3 LLM</span>
              <span>{Math.round(progress.llm || 0)}%</span>
            </div>
            <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <motion.div
                className="bg-purple-500 h-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress.llm || 0}%` }}
              />
            </div>
          </div>
        </div>
        <p className="mt-12 text-slate-500 text-[10px] uppercase tracking-[0.2em] font-medium border-t border-slate-900 pt-4">
          Requires WebGPU • ~2.5GB Download
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800/50 bg-slate-900/40 backdrop-blur-xl sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={cn("w-3 h-3 rounded-full transition-colors duration-500", (vad.userSpeaking) ? "bg-green-500" : "bg-red-500")} />
            {(vad.userSpeaking) && <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 animate-ping opacity-75" />}
          </div>
          <h1 className="font-black text-2xl tracking-tighter italic uppercase">Debate<span className="text-blue-500 not-italic">Lens</span></h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex gap-2">
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              className="bg-slate-800/50 border border-slate-700/50 text-[10px] rounded px-2 py-1 text-blue-400 font-bold"
            >
              {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label.slice(0, 20)}...</option>)}
            </select>
          </div>

          <div className="flex bg-slate-800/50 rounded-xl p-1 border border-slate-700/50 shadow-inner">
            <button
              onClick={() => setActiveSpeaker('A')}
              className={cn(
                "px-5 py-2 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2",
                activeSpeaker === 'A'
                  ? "bg-blue-600 text-white shadow-[0_4px_20px_rgba(37,99,235,0.4)] scale-105"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              Speaker A <span className="opacity-50 text-[10px] bg-black/20 px-1 rounded">1</span>
            </button>
            <button
              onClick={() => setActiveSpeaker('B')}
              className={cn(
                "px-5 py-2 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2",
                activeSpeaker === 'B'
                  ? "bg-red-600 text-white shadow-[0_4px_20px_rgba(220,38,38,0.4)] scale-105"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              Speaker B <span className="opacity-50 text-[10px] bg-black/20 px-1 rounded">2</span>
            </button>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
            Press <kbd className="bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700 text-slate-300">TAB</kbd> to swap
          </div>

          <div className="flex items-center gap-2 border-l border-slate-800 pl-6">
            <button
              onClick={copyToClipboard}
              className="p-2.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-blue-400 transition-all active:scale-95"
              title="Copy Transcript"
            >
              <Copy className="w-5 h-5" />
            </button>
            <button
              onClick={clearFeed}
              className="p-2.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-red-400 transition-all active:scale-95"
              title="Clear Feed"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={toggleListening}
            className={cn(
              "hidden md:flex items-center gap-2 px-4 py-2 rounded-xl border font-bold text-xs uppercase tracking-widest transition-all duration-300 active:scale-95",
              !vad.listening
                ? "border-red-500/50 bg-red-500/10 text-red-400"
                : (vad.userSpeaking)
                  ? "border-green-500/50 bg-green-500/10 text-green-400 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
                  : "border-slate-700 bg-slate-800/50 text-slate-500"
            )}
          >
            {!vad.listening ? <MicOff className="w-3.5 h-3.5" /> : ((vad.userSpeaking) ? <Mic className="w-3.5 h-3.5 animate-bounce" /> : <Mic className="w-3.5 h-3.5" />)}
            {!vad.listening ? "Muted" : ((vad.userSpeaking) ? "Live Audio" : "Listening")}
          </button>
        </div>
      </header>

      {/* Manual Input Section */}
      <div className="px-6 py-4 bg-slate-900/30 border-b border-slate-800/30">
        <form onSubmit={handleManualSubmit} className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1 w-full">
            <label htmlFor="manual-input" className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
              Manual Input (for text fact-checking)
            </label>
            <textarea
              id="manual-input"
              placeholder={`Enter text to fact-check as Speaker ${activeSpeaker}`}
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleManualSubmit(e);
                }
              }}
            />
            <p className="text-xs text-slate-500 mt-2">
              Minimum 3 words required • Press Enter to submit
            </p>
          </div>
          <button
            type="submit"
            className="mt-4 sm:mt-0 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-colors whitespace-nowrap"
          >
            Submit for Fact-Check
          </button>
        </form>
      </div>

      {/* Main Feed */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 scroll-smooth"
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {transcripts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className={cn(
                "flex flex-col max-w-[85%] md:max-w-[70%] space-y-3",
                t.speaker === 'A' ? "self-start" : "self-end items-end"
              )}
            >
              <div className={cn(
                "px-6 py-5 rounded-3xl text-lg md:text-xl shadow-2xl transition-all duration-700 leading-relaxed relative overflow-hidden",
                t.speaker === 'A' 
                  ? "bg-slate-900/80 rounded-tl-none border-l-4 border-blue-500/50" 
                  : "bg-slate-900/80 rounded-tr-none border-r-4 border-red-500/50 text-right",
                t.isChecking && (t.speaker === 'A' ? "shadow-[0_0_50px_rgba(59,130,246,0.3)] border-blue-400" : "shadow-[0_0_50px_rgba(239,68,68,0.3)] border-red-400")
              )}>
                {t.isChecking && (
                  <motion.div 
                    className={cn(
                      "absolute inset-0 opacity-20 pointer-events-none",
                      t.speaker === 'A' ? "bg-gradient-to-r from-blue-600/0 via-blue-600/50 to-blue-600/0" : "bg-gradient-to-r from-red-600/0 via-red-600/50 to-red-600/0"
                    )}
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  />
                )}
                <div className={cn(
                  "flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] mb-3",
                  t.speaker === 'A' ? "text-blue-500" : "text-red-500 justify-end"
                )}>
                  {t.speaker === 'A' && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />}
                  Speaker {t.speaker}
                  {t.speaker === 'B' && <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />}
                </div>
                <span className="text-slate-100 font-medium relative z-10">
                  {t.text}
                </span>
              </div>

              {t.isChecking && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    "flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-blue-400/70",
                    t.speaker === 'B' && "flex-row-reverse"
                  )}
                >
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analyzing Claim...
                </motion.div>
              )}

              {t.factCheck && t.factCheck.verdict !== 'NOT_A_CLAIM' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    "p-5 rounded-2xl border text-sm w-full shadow-xl backdrop-blur-md relative overflow-hidden",
                    t.factCheck.verdict === 'True' && "bg-green-500/10 border-green-500/30 text-green-50",
                    t.factCheck.verdict === 'False' && "bg-red-500/10 border-red-500/30 text-red-50",
                    t.factCheck.verdict === 'Unverified' && "bg-yellow-500/10 border-yellow-500/30 text-yellow-50"
                  )}
                >
                  <div className={cn(
                    "flex items-center gap-2 font-black text-[11px] uppercase tracking-[0.2em] mb-3",
                    t.factCheck.verdict === 'True' && "text-green-400",
                    t.factCheck.verdict === 'False' && "text-red-400",
                    t.factCheck.verdict === 'Unverified' && "text-yellow-400"
                  )}>
                    {t.factCheck.verdict === 'True' && <CheckCircle2 className="w-4 h-4" />}
                    {t.factCheck.verdict === 'False' && <XCircle className="w-4 h-4" />}
                    {t.factCheck.verdict === 'Unverified' && <AlertCircle className="w-4 h-4" />}
                    {t.factCheck.verdict}
                  </div>
                  <p className="opacity-90 leading-relaxed font-medium">
                    {t.factCheck.explanation}
                  </p>
                  
                  {/* Decorative glow */}
                  <div className={cn(
                    "absolute top-0 right-0 w-24 h-24 blur-[40px] opacity-20 -mr-12 -mt-12 rounded-full",
                    t.factCheck.verdict === 'True' && "bg-green-500",
                    t.factCheck.verdict === 'False' && "bg-red-500",
                    t.factCheck.verdict === 'Unverified' && "bg-yellow-500"
                  )} />
                </motion.div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {transcripts.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-6 opacity-30">
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-2 border-dashed border-slate-700 flex items-center justify-center">
                <Mic className="w-10 h-10" />
              </div>
              <div className="absolute -bottom-2 -right-2 bg-slate-950 p-1">
                <Loader2 className="w-6 h-6 animate-spin-slow text-slate-800" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-xl font-bold tracking-tight">System Ready</p>
              <p className="text-sm">Speak into your microphone to begin analysis</p>
            </div>
          </div>
        )}
      </main>

      {/* Footer / Info */}
      <footer className="px-6 py-3 text-[9px] flex justify-between items-center text-slate-600 uppercase tracking-[0.3em] font-bold border-t border-slate-900 bg-slate-950">
        <div className="flex gap-4">
          <span>WebGPU Active</span>
          <span>Whisper-Tiny</span>
          <span>Phi-3 Mini</span>
        </div>
        <div className="hidden sm:block">
          DebateLens v0.2.0 • Real-time Fact-Checking
        </div>
      </footer>

      <style jsx global>{`
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: #1e293b;
          border-radius: 10px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #334155;
        }
      `}</style>
    </div>
  );
}
