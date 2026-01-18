import { renderHook } from '@testing-library/react';
import { useAudioProcessor } from './useAudioProcessor';
import { useMicVAD } from '@ricky0123/vad-react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('@ricky0123/vad-react', () => ({
  useMicVAD: vi.fn(),
}));

describe('useAudioProcessor', () => {
  it('should return isRecording true when not loading and not errored', () => {
    (useMicVAD as any).mockReturnValue({
      loading: false,
      errored: false,
    });

    const { result } = renderHook(() => useAudioProcessor(vi.fn()));
    expect(result.current.isRecording).toBe(true);
  });

  it('should return isRecording false when loading', () => {
    (useMicVAD as any).mockReturnValue({
      loading: true,
      errored: false,
    });

    const { result } = renderHook(() => useAudioProcessor(vi.fn()));
    expect(result.current.isRecording).toBe(false);
  });

  it('should call onSpeechEnd when VAD onSpeechEnd is triggered', () => {
    const onSpeechEndMock = vi.fn();
    let capturedOnSpeechEnd: (audio: Float32Array) => void = () => {};

    (useMicVAD as any).mockImplementation((options: any) => {
      capturedOnSpeechEnd = options.onSpeechEnd;
      return {
        loading: false,
        errored: false,
      };
    });

    renderHook(() => useAudioProcessor(onSpeechEndMock));
    
    const testAudio = new Float32Array([1, 2, 3]);
    capturedOnSpeechEnd(testAudio);

    expect(onSpeechEndMock).toHaveBeenCalledWith(testAudio);
  });
});
