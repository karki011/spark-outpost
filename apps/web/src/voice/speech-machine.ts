import type { VoiceErrorCode, VoicePurpose } from '@spark-outpost/contracts';
import type { Command } from './commands.ts';

export type ListenPhase = 'starting' | 'listening' | 'working';

export interface Listen {
  phase: ListenPhase;
  id: string | null;
  purpose: VoicePurpose;
  level: number;
  heard: boolean;
}

export interface SpeechResult {
  id: number;
  transcript: string;
  command: Command;
}

export type Notice = 'missed' | VoiceErrorCode;

export interface SpeechState {
  listen: Listen | null;
  result: SpeechResult | null;
  notice: Notice | null;
  results: number;
}

export type SpeechAction =
  | { type: 'start'; purpose: VoicePurpose }
  | { type: 'started'; id: string }
  | { type: 'refused'; error: VoiceErrorCode }
  | { type: 'level'; id: string; level: number }
  | { type: 'speech'; id: string }
  | { type: 'stopping' }
  | { type: 'heard'; id: string; text: string; command: Command | null }
  | { type: 'cancelled'; id: string }
  | { type: 'failed'; id: string; error: VoiceErrorCode }
  | { type: 'escape' }
  | { type: 'close' };

export const IDLE: SpeechState = { listen: null, result: null, notice: null, results: 0 };

function ours(state: SpeechState, id: string): Listen | null {
  return state.listen && state.listen.id === id ? state.listen : null;
}

export function nextPurpose(state: SpeechState): VoicePurpose {
  return state.result ? 'confirm' : 'command';
}

export function speechReducer(state: SpeechState, action: SpeechAction): SpeechState {
  switch (action.type) {
    case 'start':
      if (state.listen) return state;
      return {
        ...state,
        notice: null,
        listen: { phase: 'starting', id: null, purpose: action.purpose, level: 0, heard: false },
      };
    case 'started':
      if (!state.listen || state.listen.phase !== 'starting') return state;
      return { ...state, listen: { ...state.listen, phase: 'listening', id: action.id } };
    case 'refused':
      return { ...state, listen: null, notice: action.error };
    case 'level': {
      const listen = ours(state, action.id);
      return listen ? { ...state, listen: { ...listen, level: action.level } } : state;
    }
    case 'speech': {
      const listen = ours(state, action.id);
      return listen ? { ...state, listen: { ...listen, heard: true } } : state;
    }
    case 'stopping':
      if (!state.listen || state.listen.phase !== 'listening') return state;
      return { ...state, listen: { ...state.listen, phase: 'working' } };
    case 'heard': {
      const listen = ours(state, action.id);
      if (!listen) return state;
      const text = action.text.trim();
      if (!text) return { ...state, listen: null, notice: 'missed' };
      if (!action.command) return { ...state, listen: null };
      const results = state.results + 1;
      return {
        listen: null,
        notice: null,
        results,
        result: { id: results, transcript: text, command: action.command },
      };
    }
    case 'cancelled':
      return ours(state, action.id) ? { ...state, listen: null } : state;
    case 'failed':
      return ours(state, action.id) ? { ...state, listen: null, notice: action.error } : state;
    case 'escape':
      if (state.listen) return { ...state, listen: null };
      return { ...state, result: null, notice: null };
    case 'close':
      return { ...IDLE, results: state.results };
  }
}
