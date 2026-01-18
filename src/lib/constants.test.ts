import { describe, it, expect } from 'vitest';
import { MODELS, VAD_MODEL_URL } from './constants';

describe('constants', () => {
  it('should have correct MODELS', () => {
    expect(MODELS.STT).toBe('onnx-community/whisper-tiny.en');
    expect(MODELS.LLM).toBe('Xenova/Phi-3-mini-4k-instruct');
  });

  it('should have correct VAD_MODEL_URL', () => {
    expect(VAD_MODEL_URL).toBe('https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.7/dist/silero_vad.onnx');
  });
});
