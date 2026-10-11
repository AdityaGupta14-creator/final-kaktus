'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { listAgentModels } from '@/lib/agent/client';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';

export interface Model {
  name: string;
  version: string;
  displayName: string;
  description: string;
}

export const FALLBACK_MODELS: Model[] = [
  { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', version: '2.5', description: 'Fast and lightweight' },
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', version: '2.5', description: 'Balanced performance' },
  { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite', version: '3.5', description: 'Next-gen fast' },
  { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', version: '3.5', description: 'High reasoning' },
  { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', version: '3.6', description: 'Advanced multimodal' },
  { name: 'models/gemini-3.7-flash', displayName: 'Gemini 3.7 Flash', version: '3.7', description: 'State of the art' },
  { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', version: '3.8', description: 'Ultimate pro tier' },
];

interface ModelSelectorProps {
  apiKey: string;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onAvailableModelsChange?: (models: Array<Pick<Model, 'name' | 'displayName'>>) => void;
  variant?: 'default' | 'minimal';
}

export function ModelSelector({ apiKey, selectedModel, onModelChange, onAvailableModelsChange, variant = 'default' }: ModelSelectorProps) {
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { plan } = useAuth();
  const router = useRouter();

  const isModelLocked = (id: string, currentPlan: string) => {
    const p = (currentPlan || 'free').toLowerCase();
    if (p === 'pro' || p === 'super_admin' || p === 'admin') return false;
    if (p === 'booster') {
      return ['models/gemini-3.7-flash', 'models/gemini-3.8-flash'].includes(id);
    }
    if (p === 'starter') {
      return ['models/gemini-3.5-flash', 'models/gemini-3.6-flash', 'models/gemini-3.7-flash', 'models/gemini-3.8-flash'].includes(id);
    }
    // Free: only gets Gemini 2.5 Flash Lite & Gemini 2.5 Flash
    return ['models/gemini-3.5-flash-lite', 'models/gemini-3.5-flash', 'models/gemini-3.6-flash', 'models/gemini-3.7-flash', 'models/gemini-3.8-flash'].includes(id);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const keyToQuery = apiKey || 'server_managed';
    
    setLoading(true);
    
    listAgentModels(keyToQuery)
      .then(fetchedModels => {
        const allowedIds = [
          'models/gemini-2.5-flash-lite',
          'models/gemini-2.5-flash',
          'models/gemini-3.5-flash-lite',
          'models/gemini-3.5-flash',
          'models/gemini-3.6-flash',
          'models/gemini-3.7-flash',
          'models/gemini-3.8-flash'
        ];

        let filteredModels = (fetchedModels && fetchedModels.length > 0)
          ? fetchedModels.filter(m => allowedIds.includes(m.name))
          : FALLBACK_MODELS;

        if (filteredModels.length === 0) {
          filteredModels = FALLBACK_MODELS;
        }

        filteredModels.sort((a, b) => allowedIds.indexOf(a.name) - allowedIds.indexOf(b.name));

        setModels(filteredModels);
        onAvailableModelsChange?.(
          filteredModels
            .filter(model => !isModelLocked(model.name, plan))
            .map(({ name, displayName }) => ({ name, displayName })),
        );
        
        // Set default if none selected or not in list
        if (filteredModels.length > 0 && (!selectedModel || !filteredModels.find(m => m.name === selectedModel))) {
          onModelChange(filteredModels[0].name);
        }
      })
      .catch(err => {
        console.warn('[ModelSelector] Using fallback models list:', err?.message || err);
        setModels(FALLBACK_MODELS);
        onAvailableModelsChange?.(
          FALLBACK_MODELS
            .filter(model => !isModelLocked(model.name, plan))
            .map(({ name, displayName }) => ({ name, displayName })),
        );
        if (!selectedModel) {
          onModelChange(FALLBACK_MODELS[0].name);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiKey, onAvailableModelsChange, plan]);

  const activeModel = models.find(m => m.name === selectedModel) || models[0];

  const getCleanLabel = (model: Model | undefined) => {
    if (!model) return 'Select Model';
    let label = model.displayName || model.name.replace('models/', '');
    label = label.replace(/Medium|High|Fast|\(Thinking\)|Notice/gi, '').trim();
    label = label.replace(/\s+/g, ' ');
    return label;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading && models.length === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-[#1a1a1a] transition-colors text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
      >
        <span className="font-semibold text-gray-300">
          {getCleanLabel(activeModel)}
        </span>
        <ChevronDown size={14} className="opacity-70" />
      </button>

      {isOpen && models.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-72 bg-[#1e1e1e] border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-[#2a2a2a] flex items-center justify-between">
            <span>Model</span>
            <span className="text-[10px] text-gray-400 uppercase font-mono">{plan || 'FREE'} PLAN</span>
          </div>
          <div className="flex flex-col p-1.5 max-h-[320px] overflow-y-auto custom-scrollbar">
            {models.map((model) => {
              const isActive = selectedModel === model.name;
              const locked = isModelLocked(model.name, plan);
              return (
                <div
                  key={model.name}
                  onClick={() => {
                    if (locked) {
                      setIsOpen(false);
                      router.push('/#pricing');
                    } else {
                      onModelChange(model.name);
                      setIsOpen(false);
                    }
                  }}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-colors cursor-pointer select-none ${
                    isActive && !locked 
                      ? 'bg-[#2a2a2a] text-white' 
                      : locked
                      ? 'text-gray-400 hover:bg-[#222]'
                      : 'text-gray-300 hover:bg-[#222] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
                    <span className={`font-medium truncate ${locked ? 'text-gray-400' : 'text-gray-200'}`}>
                      {getCleanLabel(model)}
                    </span>
                  </div>
                  {locked ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsOpen(false);
                        router.push('/#pricing');
                      }}
                      className="bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 hover:text-orange-300 border border-orange-500/30 text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer shadow-sm hover:scale-105 active:scale-95 flex-shrink-0"
                    >
                      <Lock size={10} /> Upgrade
                    </button>
                  ) : (
                    isActive && <ChevronRight size={14} className="opacity-100 flex-shrink-0 text-blue-400" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
