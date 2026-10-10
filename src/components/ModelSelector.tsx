'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { listAgentModels } from '@/lib/agent/client';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';

interface Model {
  name: string;
  version: string;
  displayName: string;
  description: string;
}

interface ModelSelectorProps {
  apiKey: string;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onAvailableModelsChange?: (models: Array<Pick<Model, 'name' | 'displayName'>>) => void;
  variant?: 'default' | 'minimal';
}

export function ModelSelector({ apiKey, selectedModel, onModelChange, onAvailableModelsChange, variant = 'default' }: ModelSelectorProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { plan } = useAuth();
  const router = useRouter();

  const isModelLocked = (id: string, currentPlan: string) => {
    if (currentPlan === 'pro') return false;
    if (currentPlan === 'booster') {
      return ['models/gemini-3.7-flash', 'models/gemini-3.8-flash'].includes(id);
    }
    if (currentPlan === 'starter') {
      return ['models/gemini-3.5-flash', 'models/gemini-3.6-flash', 'models/gemini-3.7-flash', 'models/gemini-3.8-flash'].includes(id);
    }
    // Free
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
    if (!apiKey) return;
    
    setLoading(true);
    setError('');
    
    listAgentModels(apiKey)
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

        let filteredModels = fetchedModels.filter(m => allowedIds.includes(m.name));
        filteredModels.sort((a, b) => allowedIds.indexOf(a.name) - allowedIds.indexOf(b.name));

        setModels(filteredModels);
        onAvailableModelsChange?.(
          filteredModels
            .filter(model => !isModelLocked(model.name, plan))
            .map(({ name, displayName }) => ({ name, displayName })),
        );
        
        // Only set default if we have none, or the selected one isn't in the list
        if (filteredModels.length > 0 && (!selectedModel || !filteredModels.find(m => m.name === selectedModel))) {
          onModelChange(filteredModels[0].name);
        }
      })
      .catch(err => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [apiKey, onAvailableModelsChange, plan]);

  const activeModel = models.find(m => m.name === selectedModel) || models[0];

  const getCleanLabel = (model: Model | undefined) => {
    if (!model) return 'Select Model';
    let label = model.displayName || model.name.replace('models/', '');
    // Clean up "Medium", "High", "Fast", "(Thinking)", etc.
    label = label.replace(/Medium|High|Fast|\(Thinking\)|Notice/gi, '').trim();
    // Also cleanup extra spaces
    label = label.replace(/\s+/g, ' ');
    return label;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading || !apiKey || models.length === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full hover:bg-[#1a1a1a] transition-colors text-xs text-gray-400 hover:text-gray-200 disabled:opacity-50"
      >
        <span className="font-semibold text-gray-300">
          {!apiKey ? 'No API Key' : loading ? 'Loading...' : error ? 'Error' : getCleanLabel(activeModel)}
        </span>
        <ChevronDown size={14} className="opacity-70" />
      </button>

      {isOpen && models.length > 0 && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-[#1e1e1e] border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 text-[11px] font-semibold text-gray-500 uppercase tracking-wider border-b border-[#2a2a2a]">
            Model
          </div>
          <div className="flex flex-col p-1.5 max-h-[300px] overflow-y-auto custom-scrollbar">
            {models.map((model) => {
              const isActive = selectedModel === model.name;
              const locked = isModelLocked(model.name, plan);
              return (
                <button
                  key={model.name}
                  onClick={() => {
                    if (locked) {
                      router.push('/#pricing');
                    } else {
                      onModelChange(model.name);
                      setIsOpen(false);
                    }
                  }}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-colors ${isActive ? 'bg-[#2a2a2a] text-white' : 'text-gray-400 hover:bg-[#222] hover:text-gray-200'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`font-medium text-left ${locked ? 'opacity-50' : ''}`}>{getCleanLabel(model)}</span>
                    {locked && <span className="bg-orange-500/20 text-orange-400 text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1"><Lock size={8} /> Upgrade</span>}
                  </div>
                  {isActive && !locked && <ChevronRight size={14} className="opacity-100 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
