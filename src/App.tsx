/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Settings,
  Upload,
  Headphones,
  Eye,
  EyeOff,
  Zap,
  Search,
  BookOpen,
  X,
  Globe,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { extractPdfData, PdfSegment } from './services/pdfService';
import { cn } from './lib/utils';

interface WordProps {
  word: string;
  isCurrent: boolean;
}

const Word = React.memo(({ word, isCurrent }: WordProps) => (
  <span
    data-active={isCurrent}
    className={cn(
      'transition-colors duration-75 inline-block scroll-mt-64 md:scroll-mt-80 rounded px-1',
      isCurrent
        ? 'text-orange-400 font-bold bg-orange-500/20 ring-1 ring-orange-500/50 shadow-[0_0_20px_rgba(234,88,12,0.35)]'
        : 'text-zinc-200'
    )}
  >
    {word}
  </span>
));

interface ChunkProps {
  index: number;
  segment: PdfSegment;
  showPageBadge: boolean;
  isActive: boolean;
  activeCharIndex: number;
  searchQuery: string;
  onSelect: (index: number) => void;
}

const Chunk = React.memo(
  ({ index, segment, showPageBadge, isActive, activeCharIndex, searchQuery, onSelect }: ChunkProps) => {
    const { text: chunk, offset, page } = segment;

    const matchesSearch =
      searchQuery.trim().length > 1 &&
      chunk.toLowerCase().includes(searchQuery.trim().toLowerCase());

    if (!isActive) {
      return (
        <div
          onClick={() => onSelect(index)}
          className={cn(
            'group cursor-pointer rounded-2xl px-4 py-3 mb-3 transition-all border border-transparent hover:border-zinc-800 hover:bg-zinc-900/50',
            matchesSearch && 'border-orange-500/40 bg-orange-500/5'
          )}
        >
          {showPageBadge && (
            <div className="flex items-center gap-2 mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-500">
              <BookOpen size={11} className="text-orange-500/70" />
              <span>Página {page}</span>
              <div className="h-px flex-1 bg-zinc-800/60" />
            </div>
          )}
          <p className="text-zinc-400/75 group-hover:text-zinc-200 text-base md:text-lg leading-relaxed transition-colors select-none">
            {chunk}
          </p>
        </div>
      );
    }

    const words = chunk.split(/(\s+)/);
    let currentPos = offset;

    return (
      <div
        data-active-chunk="true"
        onClick={() => onSelect(index)}
        className="bg-orange-500/[0.05] rounded-3xl p-6 md:p-9 my-6 ring-1 ring-orange-500/30 shadow-[0_0_40px_rgba(234,88,12,0.08)] cursor-pointer"
      >
        <div className="flex items-center justify-between mb-3 text-[10px] font-black uppercase tracking-widest text-orange-400/90">
          <span className="flex items-center gap-1.5">
            <BookOpen size={12} /> Página {page} · Oración {index + 1}
          </span>
          <span className="text-zinc-500">Clic en cualquier párrafo para saltar</span>
        </div>
        <p className="text-xl md:text-3xl leading-[1.45] font-semibold tracking-tight">
          {words.map((word, wordIdx) => {
            const start = currentPos;
            const end = currentPos + word.length;
            currentPos = end;

            const isWhitespace = /^\s+$/.test(word);
            if (isWhitespace) return <span key={wordIdx}>{word}</span>;

            const isCurrent = activeCharIndex >= start && activeCharIndex < end;
            return <Word key={wordIdx} word={word} isCurrent={isCurrent} />;
          })}
        </p>
      </div>
    );
  },
  (prev, next) => {
    if (prev.isActive !== next.isActive) return false;
    if (prev.showPageBadge !== next.showPageBadge) return false;
    if (prev.searchQuery !== next.searchQuery) return false;
    if (!next.isActive) return true;
    return prev.activeCharIndex === next.activeCharIndex;
  }
);

const WINDOW_RADIUS = 35; // Render 70 chunks around active view for instant 60fps performance

export default function App() {
  const [pdfText, setPdfText] = useState<string>('');
  const [segments, setSegments] = useState<PdfSegment[]>([]);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [fileName, setFileName] = useState<string>('');
  const [fileKey, setFileKey] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadProgress, setLoadProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [isDragging, setIsDragging] = useState(false);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [allVoicesMode, setAllVoicesMode] = useState(false);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const [rate, setRate] = useState<number>(() => {
    const saved = localStorage.getItem('vozpdf_rate');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [volume, setVolume] = useState<number>(1.0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [activeCharIndex, setActiveCharIndex] = useState(-1);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [viewCenterIndex, setViewCenterIndex] = useState(0);
  const [showText, setShowText] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const utteranceIdRef = useRef<number>(0);
  const fallbackTimerRef = useRef<number | null>(null);
  const boundaryFiredRef = useRef<boolean>(false);
  const charInChunkRef = useRef<number>(0);

  // Refs for fresh state access inside speech callbacks
  const segmentsRef = useRef<PdfSegment[]>(segments);
  segmentsRef.current = segments;
  const rateRef = useRef<number>(rate);
  rateRef.current = rate;
  const volumeRef = useRef<number>(volume);
  volumeRef.current = volume;
  const voicesRef = useRef<SpeechSynthesisVoice[]>(voices);
  voicesRef.current = voices;
  const selectedVoiceURIRef = useRef<string>(selectedVoiceURI);
  selectedVoiceURIRef.current = selectedVoiceURI;
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;
  const currentChunkIndexRef = useRef<number>(currentChunkIndex);
  currentChunkIndexRef.current = currentChunkIndex;

  const clearFallbackTimer = () => {
    if (fallbackTimerRef.current !== null) {
      window.clearInterval(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  };

  // Load & Sort Voices (Prioritize Natural / Spanish voices, fallback to all voices)
  useEffect(() => {
    const loadVoices = () => {
      const rawVoices = window.speechSynthesis.getVoices();
      if (!rawVoices || rawVoices.length === 0) return;

      const spanishVoices = rawVoices.filter((v) => v.lang.toLowerCase().startsWith('es'));
      const pool = allVoicesMode || spanishVoices.length === 0 ? rawVoices : spanishVoices;

      const sorted = [...pool].sort((a, b) => {
        const aNat = /natural|online|neural|google/i.test(a.name) ? 1 : 0;
        const bNat = /natural|online|neural|google/i.test(b.name) ? 1 : 0;
        if (aNat !== bNat) return bNat - aNat;

        const aLat = /es-(AR|MX|419|US|CO|CL)/i.test(a.lang) ? 1 : 0;
        const bLat = /es-(AR|MX|419|US|CO|CL)/i.test(b.lang) ? 1 : 0;
        if (aLat !== bLat) return bLat - aLat;
        return a.name.localeCompare(b.name);
      });

      setVoices(sorted);
      setSelectedVoiceURI((prev) => {
        if (prev && sorted.some((v) => v.voiceURI === prev)) return prev;
        const savedURI = localStorage.getItem('vozpdf_voice');
        if (savedURI && sorted.some((v) => v.voiceURI === savedURI)) return savedURI;
        return sorted[0]?.voiceURI || '';
      });
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, [allVoicesMode]);

  // Estimate duration & elapsed time accurately
  const duration = useMemo(() => {
    if (!pdfText) return 0;
    // Average ~14 chars per second at 1.0x in Spanish
    return pdfText.length / (14 * rate);
  }, [pdfText, rate]);

  const elapsed = useMemo(() => {
    if (!pdfText || duration === 0) return 0;
    const effectiveChar =
      activeCharIndex >= 0
        ? activeCharIndex
        : segments[currentChunkIndex]?.offset || 0;
    const progress = Math.min(1, Math.max(0, effectiveChar / pdfText.length));
    return duration * progress;
  }, [activeCharIndex, currentChunkIndex, segments, pdfText, duration]);

  // Save reading progress per file in localStorage
  useEffect(() => {
    if (!fileKey || segments.length === 0) return;
    localStorage.setItem(
      `vozpdf_pos_${fileKey}`,
      JSON.stringify({ chunkIndex: currentChunkIndex, updatedAt: Date.now() })
    );
  }, [currentChunkIndex, fileKey, segments.length]);

  // Keep view window centered on active chunk during playback
  useEffect(() => {
    if (Math.abs(currentChunkIndex - viewCenterIndex) > WINDOW_RADIUS - 8) {
      setViewCenterIndex(currentChunkIndex);
    }
  }, [currentChunkIndex, viewCenterIndex]);

  const speakChunk = useCallback((index: number, startCharOffset: number = 0) => {
    const segs = segmentsRef.current;
    if (index < 0 || index >= segs.length) {
      clearFallbackTimer();
      setIsPlaying(false);
      setIsPaused(false);
      setActiveCharIndex(-1);
      return;
    }

    const myId = ++utteranceIdRef.current;
    clearFallbackTimer();
    window.speechSynthesis.cancel();

    const seg = segs[index];
    const safeOffset = Math.min(Math.max(0, startCharOffset), Math.max(0, seg.text.length - 1));
    const textToSpeak = safeOffset > 0 ? seg.text.slice(safeOffset) : seg.text;

    setCurrentChunkIndex(index);
    charInChunkRef.current = safeOffset;
    setActiveCharIndex(seg.offset + safeOffset);
    boundaryFiredRef.current = false;

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    const chosenVoice =
      voicesRef.current.find((v) => v.voiceURI === selectedVoiceURIRef.current) ||
      voicesRef.current[0];

    if (chosenVoice) {
      utterance.voice = chosenVoice;
      utterance.lang = chosenVoice.lang;
    } else {
      utterance.lang = 'es-ES';
    }

    utterance.rate = rateRef.current;
    utterance.volume = volumeRef.current;

    // Fallback word highlighter for voices that don't emit 'onboundary'
    const charsPerSec = 14 * rateRef.current;
    const startedAt = performance.now();
    fallbackTimerRef.current = window.setInterval(() => {
      if (utteranceIdRef.current !== myId || boundaryFiredRef.current) return;
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const estChar = Math.min(
        seg.text.length - 1,
        safeOffset + Math.floor(elapsedSec * charsPerSec)
      );
      charInChunkRef.current = estChar;
      setActiveCharIndex(seg.offset + estChar);
    }, 90);

    utterance.onboundary = (event) => {
      if (utteranceIdRef.current !== myId) return;
      if (event.name === 'word' || typeof event.charIndex === 'number') {
        boundaryFiredRef.current = true;
        const absInChunk = safeOffset + event.charIndex;
        charInChunkRef.current = absInChunk;
        setActiveCharIndex(seg.offset + absInChunk);
      }
    };

    utterance.onend = () => {
      if (utteranceIdRef.current !== myId) return;
      clearFallbackTimer();
      if (index + 1 < segmentsRef.current.length) {
        speakChunk(index + 1, 0);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
        setActiveCharIndex(-1);
      }
    };

    utterance.onerror = (e) => {
      if (utteranceIdRef.current !== myId) return;
      // Ignore canceled / interrupted events caused by seeking, pausing, or voice switching
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.warn('TTS Warning:', e.error);
      clearFallbackTimer();
      setIsPlaying(false);
    };

    utteranceRef.current = utterance;
    setIsPlaying(true);
    setIsPaused(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(() => {
    if (segmentsRef.current.length === 0) return;
    speakChunk(currentChunkIndexRef.current, isPaused ? charInChunkRef.current : 0);
  }, [isPaused, speakChunk]);

  const pause = useCallback(() => {
    utteranceIdRef.current++;
    clearFallbackTimer();
    window.speechSynthesis.cancel();
    setIsPaused(true);
    setIsPlaying(false);
  }, []);

  const stop = useCallback(() => {
    utteranceIdRef.current++;
    clearFallbackTimer();
    window.speechSynthesis.cancel();
    charInChunkRef.current = 0;
    setIsPlaying(false);
    setIsPaused(false);
    setActiveCharIndex(-1);
    setCurrentChunkIndex(0);
    setViewCenterIndex(0);
  }, []);

  const jumpToChunk = useCallback(
    (targetIdx: number, forcePlay?: boolean) => {
      const segs = segmentsRef.current;
      if (segs.length === 0) return;
      const clamped = Math.min(segs.length - 1, Math.max(0, targetIdx));
      charInChunkRef.current = 0;
      setCurrentChunkIndex(clamped);
      setViewCenterIndex(clamped);
      setActiveCharIndex(segs[clamped].offset);

      if (forcePlay ?? isPlayingRef.current) {
        speakChunk(clamped, 0);
      } else {
        utteranceIdRef.current++;
        clearFallbackTimer();
        window.speechSynthesis.cancel();
        setIsPaused(true);
        setIsPlaying(false);
      }
    },
    [speakChunk]
  );

  // Live update when changing voice, speed, or volume while playing
  const handleRateChange = (newRate: number) => {
    const rounded = Math.round(newRate * 10) / 10;
    const clamped = Math.min(2.5, Math.max(0.5, rounded));
    setRate(clamped);
    rateRef.current = clamped;
    localStorage.setItem('vozpdf_rate', String(clamped));
    if (isPlayingRef.current) {
      speakChunk(currentChunkIndexRef.current, charInChunkRef.current);
    }
  };

  const handleVoiceChange = (uri: string) => {
    setSelectedVoiceURI(uri);
    selectedVoiceURIRef.current = uri;
    localStorage.setItem('vozpdf_voice', uri);
    if (isPlayingRef.current) {
      speakChunk(currentChunkIndexRef.current, charInChunkRef.current);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    volumeRef.current = newVol;
    if (isPlayingRef.current) {
      speakChunk(currentChunkIndexRef.current, charInChunkRef.current);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!pdfText || segments.length === 0) return;
    const newPercentage = parseFloat(e.target.value);
    const targetCharIndex = (newPercentage / 100) * pdfText.length;

    let targetChunkIdx = 0;
    for (let i = 0; i < segments.length; i++) {
      if (targetCharIndex >= segments[i].offset) {
        targetChunkIdx = i;
      } else {
        break;
      }
    }
    jumpToChunk(targetChunkIdx);
  };

  const skipSeconds = useCallback(
    (seconds: number) => {
      if (!duration || !pdfText || segments.length === 0) return;
      const currentPercent = (elapsed / duration) * 100;
      const skipPercent = (seconds / duration) * 100;
      const newPercent = Math.min(100, Math.max(0, currentPercent + skipPercent));
      const targetCharIndex = (newPercent / 100) * pdfText.length;

      let targetChunkIdx = 0;
      for (let i = 0; i < segments.length; i++) {
        if (targetCharIndex >= segments[i].offset) {
          targetChunkIdx = i;
        } else {
          break;
        }
      }
      jumpToChunk(targetChunkIdx);
    },
    [duration, elapsed, pdfText, segments, jumpToChunk]
  );

  const jumpToPage = (pageNum: number) => {
    const idx = segments.findIndex((s) => s.page >= pageNum);
    if (idx !== -1) {
      jumpToChunk(idx);
    }
  };

  // Keyboard shortcuts for agile navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!pdfText) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlayingRef.current) pause();
        else speak();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) skipSeconds(15);
        else jumpToChunk(currentChunkIndexRef.current + 1);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) skipSeconds(-15);
        else jumpToChunk(currentChunkIndexRef.current - 1);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        handleRateChange(rateRef.current + 0.1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        handleRateChange(rateRef.current - 0.1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pdfText, pause, speak, skipSeconds, jumpToChunk]);

  // Clean up TTS on unmount
  useEffect(() => {
    return () => {
      clearFallbackTimer();
      window.speechSynthesis.cancel();
    };
  }, []);

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Smooth auto-scroll to active sentence
  useEffect(() => {
    if (!containerRef.current || !showText) return;
    const timer = setTimeout(() => {
      const activeChunkEl = containerRef.current?.querySelector('[data-active-chunk="true"]');
      if (activeChunkEl) {
        activeChunkEl.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [currentChunkIndex, showText]);

  const processFile = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      alert('Por favor selecciona un archivo PDF válido.');
      return;
    }

    stop();
    setIsProcessing(true);
    setLoadProgress({ current: 0, total: 1 });

    try {
      const data = await extractPdfData(file, (current, total) => {
        setLoadProgress({ current, total });
      });

      if (!data.fullText || data.segments.length === 0) {
        alert('Este PDF no contiene texto seleccionable (puede ser un documento escaneado como imagen).');
        return;
      }

      const key = `${file.name}_${file.size}`;
      setFileName(file.name.replace(/\.pdf$/i, ''));
      setFileKey(key);
      setPdfText(data.fullText);
      setSegments(data.segments);
      setTotalPages(data.totalPages);

      // Restore previous bookmark if available
      const savedRaw = localStorage.getItem(`vozpdf_pos_${key}`);
      if (savedRaw) {
        try {
          const saved = JSON.parse(savedRaw);
          if (typeof saved.chunkIndex === 'number' && saved.chunkIndex < data.segments.length) {
            setCurrentChunkIndex(saved.chunkIndex);
            setViewCenterIndex(saved.chunkIndex);
            setActiveCharIndex(data.segments[saved.chunkIndex].offset);
            return;
          }
        } catch {}
      }

      setCurrentChunkIndex(0);
      setViewCenterIndex(0);
      setActiveCharIndex(data.segments[0].offset);
    } catch (error) {
      console.error(error);
      alert('Error al procesar el archivo PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  // Search matches across all segments
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches: number[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].text.toLowerCase().includes(q)) {
        matches.push(i);
        if (matches.length >= 50) break;
      }
    }
    return matches;
  }, [searchQuery, segments]);

  // Virtualized window of chunks for instant rendering on huge PDFs
  const windowRange = useMemo(() => {
    const start = Math.max(0, viewCenterIndex - WINDOW_RADIUS);
    const end = Math.min(segments.length, viewCenterIndex + WINDOW_RADIUS);
    return { start, end };
  }, [viewCenterIndex, segments.length]);

  const currentPage = segments[currentChunkIndex]?.page || 1;
  const progressPercent = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-orange-500/40">
      {/* Header Fixed */}
      <header className="fixed top-0 inset-x-0 z-[100] bg-black/85 backdrop-blur-xl border-b border-zinc-800/60">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-orange-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-orange-600/25">
              <Headphones className="text-white" size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight truncate">
                {fileName ? fileName : 'VozPDF'}
              </h1>
              {pdfText && (
                <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-widest">
                  Pág. {currentPage} de {totalPages} · Oración {currentChunkIndex + 1}/{segments.length}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {pdfText && (
              <>
                <button
                  onClick={() => setShowSearch((s) => !s)}
                  className={cn(
                    'p-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all',
                    showSearch
                      ? 'bg-orange-600/20 border-orange-500/40 text-orange-400'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                  )}
                  title="Buscar en el PDF"
                >
                  <Search size={14} />
                  <span className="hidden sm:inline text-[10px] uppercase tracking-wider">Buscar</span>
                </button>

                {totalPages > 1 && (
                  <select
                    value={currentPage}
                    onChange={(e) => jumpToPage(Number(e.target.value))}
                    className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs font-bold rounded-lg px-2.5 py-2 focus:outline-none focus:border-orange-500"
                    title="Ir a página"
                  >
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <option key={p} value={p}>
                        Pág. {p}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={() => {
                    stop();
                    setPdfText('');
                    setSegments([]);
                    setFileName('');
                  }}
                  className="text-zinc-300 hover:text-white text-[10px] font-black uppercase tracking-widest px-3.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-all"
                >
                  Nuevo PDF
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className={cn(
          'max-w-7xl mx-auto px-6 transition-all duration-300',
          pdfText
            ? settingsExpanded
              ? 'pt-[480px] md:pt-72 pb-40'
              : 'pt-52 md:pt-72 pb-40'
            : 'pt-28 pb-24'
        )}
      >
        {/* Sticky Controls Panel */}
        {pdfText && (
          <div className="fixed top-16 inset-x-0 z-[90] px-4 md:px-6 py-3 bg-gradient-to-b from-black via-black/95 to-transparent">
            <div className="max-w-7xl mx-auto space-y-2">
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bg-zinc-900/95 backdrop-blur-2xl border border-zinc-800 p-4 md:p-5 rounded-3xl shadow-2xl ring-1 ring-white/5 flex flex-col gap-4"
              >
                <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-6">
                  {/* Playback Buttons */}
                  <div className="flex items-center justify-center gap-2 w-full lg:w-auto lg:pr-6 lg:border-r border-zinc-800">
                    <button
                      onClick={stop}
                      title="Detener y volver al inicio"
                      className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 transition-all"
                    >
                      <Square size={14} fill="currentColor" />
                    </button>

                    <button
                      onClick={() => jumpToChunk(currentChunkIndex - 1)}
                      disabled={currentChunkIndex <= 0}
                      title="Oración anterior (Flecha Izquierda)"
                      className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 transition-all"
                    >
                      <SkipBack size={15} />
                    </button>

                    <button
                      onClick={() => skipSeconds(-15)}
                      title="Retroceder 15 segundos"
                      className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 transition-all font-mono text-[10px] font-bold"
                    >
                      -15s
                    </button>

                    <button
                      onClick={() => (isPlaying ? pause() : speak())}
                      disabled={isProcessing}
                      title="Reproducir / Pausar (Barra Espaciadora)"
                      className={cn(
                        'flex-1 sm:flex-none sm:w-40 h-12 px-5 rounded-xl flex items-center justify-center gap-2 font-bold transition-all shadow-xl cursor-pointer',
                        isPlaying
                          ? 'bg-white text-black hover:bg-zinc-200'
                          : 'bg-orange-600 text-white hover:bg-orange-500 shadow-orange-600/20'
                      )}
                    >
                      {isPlaying ? (
                        <Pause size={20} fill="currentColor" />
                      ) : (
                        <Play size={20} fill="currentColor" />
                      )}
                      <span>{isPlaying ? 'Pausar' : isPaused ? 'Continuar' : 'Escuchar'}</span>
                    </button>

                    <button
                      onClick={() => skipSeconds(15)}
                      title="Adelantar 15 segundos"
                      className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 transition-all font-mono text-[10px] font-bold"
                    >
                      +15s
                    </button>

                    <button
                      onClick={() => jumpToChunk(currentChunkIndex + 1)}
                      disabled={currentChunkIndex >= segments.length - 1}
                      title="Siguiente oración (Flecha Derecha)"
                      className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-500 disabled:opacity-30 transition-all"
                    >
                      <SkipForward size={15} />
                    </button>

                    <button
                      onClick={() => setSettingsExpanded(!settingsExpanded)}
                      className={cn(
                        'w-10 h-10 rounded-xl border flex items-center justify-center transition-all lg:hidden',
                        settingsExpanded
                          ? 'bg-orange-600/20 border-orange-500/30 text-orange-400'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
                      )}
                      title="Opciones de voz y velocidad"
                    >
                      <Settings
                        size={15}
                        className={cn('transition-transform duration-300', settingsExpanded && 'rotate-45')}
                      />
                    </button>
                  </div>

                  {/* Settings Controls */}
                  <div
                    className={cn(
                      'w-full flex-1 lg:grid grid-cols-1 md:grid-cols-4 gap-4 items-center',
                      settingsExpanded ? 'grid' : 'hidden'
                    )}
                  >
                    {/* Voice Selector */}
                    <div className="md:col-span-1">
                      <div className="flex items-center justify-between mb-1">
                        <label className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                          <Volume2 size={12} className="text-orange-500" /> Narrador
                        </label>
                        <button
                          type="button"
                          onClick={() => setAllVoicesMode((m) => !m)}
                          className="text-[9px] font-bold text-zinc-500 hover:text-orange-400 flex items-center gap-1 transition-colors"
                          title="Alternar entre voces en español o todos los idiomas"
                        >
                          <Globe size={10} />
                          {allVoicesMode ? 'Todos' : 'Español'}
                        </button>
                      </div>
                      <select
                        value={selectedVoiceURI}
                        onChange={(e) => handleVoiceChange(e.target.value)}
                        className="w-full bg-zinc-800/70 border border-zinc-700/70 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-orange-500 text-zinc-200 truncate"
                      >
                        {voices.length === 0 ? (
                          <option value="">Voz predeterminada del sistema</option>
                        ) : (
                          voices.map((voice) => (
                            <option key={voice.voiceURI} value={voice.voiceURI}>
                              {voice.name} ({voice.lang})
                            </option>
                          ))
                        )}
                      </select>
                    </div>

                    {/* Speed Control */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                          Velocidad <span className="text-orange-400 font-mono ml-1">{rate.toFixed(1)}x</span>
                        </label>
                        <div className="flex gap-1">
                          {[1, 1.2, 1.5, 2].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => handleRateChange(preset)}
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-colors',
                                Math.abs(rate - preset) < 0.05
                                  ? 'bg-orange-600 text-white'
                                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
                              )}
                            >
                              {preset}x
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2.5"
                        step="0.1"
                        value={rate}
                        onChange={(e) => handleRateChange(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>

                    {/* Volume Control */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                          {volume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />} Volumen{' '}
                          <span className="text-orange-400 font-mono">{Math.round(volume * 100)}%</span>
                        </label>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                      />
                    </div>

                    {/* Visual / Agile Mode */}
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                          {showText ? <Eye size={12} /> : <EyeOff size={12} />} Vista
                        </label>
                        <span className="text-[9px] font-semibold text-emerald-400 flex items-center gap-1">
                          <Zap size={10} /> Ultra Ágil
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowText(!showText)}
                        className={cn(
                          'w-full h-9 px-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all border',
                          showText
                            ? 'bg-zinc-800/50 border-zinc-700/60 text-zinc-200 hover:bg-zinc-800'
                            : 'bg-orange-600/15 border-orange-500/30 text-orange-400'
                        )}
                      >
                        <span>{showText ? 'Modo Libro' : 'Modo Enfoque'}</span>
                        <div
                          className={cn(
                            'w-7 h-4 rounded-full p-0.5 transition-colors duration-200',
                            showText ? 'bg-zinc-700' : 'bg-orange-600'
                          )}
                        >
                          <div
                            className={cn(
                              'w-3 h-3 rounded-full bg-white transition-transform duration-200',
                              showText ? 'translate-x-0' : 'translate-x-3'
                            )}
                          />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Progress Bar Area */}
                <div className="pt-3 border-t border-zinc-800/60">
                  <div className="flex justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                    <span className="font-mono">{formatTime(elapsed)}</span>
                    <span className="text-orange-400 font-mono">{Math.round(progressPercent)}% leído</span>
                    <span className="font-mono">-{formatTime(Math.max(0, duration - elapsed))}</span>
                  </div>
                  <div className="relative h-4 flex items-center">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={progressPercent}
                      onChange={handleSeek}
                      className="absolute inset-0 w-full h-2 bg-transparent rounded-full appearance-none cursor-pointer z-10 accent-orange-500"
                    />
                    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden pointer-events-none">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all duration-150"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Collapsible Search Drawer */}
              <AnimatePresence>
                {showSearch && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl p-3 shadow-xl flex flex-col gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <Search size={15} className="text-orange-500 ml-2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Buscar palabra o frase en el documento..."
                        autoFocus
                        className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none"
                      />
                      {searchQuery && (
                        <span className="text-[11px] font-bold text-zinc-400">
                          {searchResults.length} resultados
                        </span>
                      )}
                      <button
                        onClick={() => {
                          setShowSearch(false);
                          setSearchQuery('');
                        }}
                        className="p-1 text-zinc-400 hover:text-white"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {searchResults.length > 0 && (
                      <div className="max-h-40 overflow-y-auto divide-y divide-zinc-800/60 border-t border-zinc-800 pt-1">
                        {searchResults.map((idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              jumpToChunk(idx, true);
                              setShowSearch(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-zinc-800/60 rounded-lg text-xs text-zinc-300 flex items-center justify-between gap-4"
                          >
                            <span className="truncate">{segments[idx].text}</span>
                            <span className="text-[10px] font-bold text-orange-400 shrink-0">
                              Pág. {segments[idx].page}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Text Container */}
        <div ref={containerRef} className="relative">
          {!pdfText ? (
            <motion.label
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={cn(
                'group relative block w-full aspect-video md:aspect-[21/9] border-2 border-dashed rounded-[3rem] cursor-pointer transition-all',
                isDragging
                  ? 'border-orange-500 bg-orange-500/10 scale-[1.01]'
                  : 'border-zinc-800 hover:border-orange-500/40 hover:bg-orange-500/[0.02]'
              )}
            >
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mb-5 border border-zinc-800 group-hover:scale-110 group-hover:border-orange-500/50 transition-all duration-300">
                  <Upload className="text-zinc-400 group-hover:text-orange-500" size={28} />
                </div>
                <h3 className="text-xl md:text-2xl font-bold mb-2 tracking-tight">
                  Arrastra tu PDF aquí o haz clic para abrir
                </h3>
                <p className="text-zinc-400 max-w-md mx-auto text-sm leading-relaxed">
                  Lectura por voz fluida con resaltado palabra por palabra, guardado automático de progreso y búsqueda instantánea.
                </p>
              </div>
              {isProcessing && (
                <div className="absolute inset-0 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center z-10 rounded-[3rem] p-6">
                  <div className="w-12 h-12 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin mb-5" />
                  <p className="text-orange-500 font-black text-xs uppercase tracking-[0.3em] mb-2">
                    Extrayendo texto ({loadProgress.current} / {loadProgress.total} páginas)
                  </p>
                  <div className="w-48 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 transition-all duration-150"
                      style={{
                        width: `${
                          loadProgress.total > 0
                            ? (loadProgress.current / loadProgress.total) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </motion.label>
          ) : (
            <AnimatePresence mode="wait">
              {showText ? (
                <motion.div
                  key="full-text"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="max-w-4xl mx-auto"
                >
                  <div className="bg-zinc-900/20 rounded-[2rem] p-4 md:p-8 min-h-[400px] border border-zinc-800/40 shadow-inner">
                    {windowRange.start > 0 && (
                      <button
                        onClick={() => setViewCenterIndex(Math.max(0, windowRange.start - 10))}
                        className="w-full py-2.5 mb-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-bold text-zinc-400 hover:text-white border border-zinc-800 transition-colors"
                      >
                        ↑ Mostrar párrafos anteriores (1 - {windowRange.start})
                      </button>
                    )}

                    {segments.slice(windowRange.start, windowRange.end).map((seg, localIdx) => {
                      const chunkIdx = windowRange.start + localIdx;
                      const prevPage = chunkIdx > 0 ? segments[chunkIdx - 1].page : -1;
                      const showPageBadge = seg.page !== prevPage;
                      const isChunkActive = chunkIdx === currentChunkIndex;

                      return (
                        <Chunk
                          key={chunkIdx}
                          index={chunkIdx}
                          segment={seg}
                          showPageBadge={showPageBadge}
                          isActive={isChunkActive}
                          activeCharIndex={activeCharIndex}
                          searchQuery={searchQuery}
                          onSelect={(idx) => jumpToChunk(idx, true)}
                        />
                      );
                    })}

                    {windowRange.end < segments.length && (
                      <button
                        onClick={() =>
                          setViewCenterIndex(Math.min(segments.length - 1, windowRange.end + 10))
                        }
                        className="w-full py-2.5 mt-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-bold text-zinc-400 hover:text-white border border-zinc-800 transition-colors"
                      >
                        ↓ Mostrar siguientes párrafos ({windowRange.end + 1} - {segments.length})
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="lazy-text"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="max-w-4xl mx-auto"
                >
                  <div className="bg-zinc-900/30 rounded-[2rem] p-8 md:p-16 min-h-[350px] border border-zinc-800/30 shadow-inner flex flex-col justify-center items-center text-center relative overflow-hidden backdrop-blur-md">
                    <div className="absolute top-4 right-6 flex items-center gap-1.5 text-[9px] font-bold text-zinc-400 uppercase tracking-widest bg-zinc-800/40 px-3 py-1 rounded-lg border border-zinc-700/40">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Modo Enfoque · Pág. {currentPage}
                    </div>

                    <div className="space-y-6 md:space-y-8 w-full max-w-2xl px-4">
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-500 flex items-center justify-center gap-2">
                        Oración {currentChunkIndex + 1} de {segments.length}
                      </span>
                      <p className="text-xl md:text-3xl leading-relaxed md:leading-[1.45] font-semibold text-zinc-100 tracking-wide">
                        {segments[currentChunkIndex]?.text}
                      </p>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                        Usa las flechas ← → para cambiar de oración o Espacio para pausar
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </main>
    </div>
  );
}
