import React from 'react';
import { Sparkles, X } from 'lucide-react';

type AIAssistantModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function AIAssistantModal({ isOpen, onClose }: AIAssistantModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 mx-auto mt-20 w-[min(92vw,560px)] rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-gradient-to-r from-pink-500 to-violet-600 p-2 text-white">
              <Sparkles size={16} />
            </div>
            <h3 className="text-lg font-bold">مساعد AI</h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          مرحباً! هذا نموذج مساعد AI مؤقت، ويمكن ربطه لاحقاً بخدمة Gemini أو أي API آخر.
        </div>
      </div>
    </div>
  );
}
