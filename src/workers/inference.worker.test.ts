import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock @huggingface/transformers
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: {
    allowLocalModels: true,
    useBrowserCache: true,
  },
}));

import { pipeline } from '@huggingface/transformers';

describe('inference.worker', () => {
  let mockPostMessage: any;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockPostMessage = vi.fn();
    
    // Create a mock self that we can track
    const mockSelf = {
      postMessage: mockPostMessage,
      onmessage: null as any,
    };
    
    vi.stubGlobal('self', mockSelf);

    // Import the worker which should assign self.onmessage
    await import('./inference.worker');
  });

  it('should handle load message', async () => {
    const mockSTT = vi.fn();
    const mockLLM = vi.fn();
    (pipeline as any).mockImplementation((type: string) => {
      if (type === 'automatic-speech-recognition') return Promise.resolve(mockSTT);
      if (type === 'text-generation') return Promise.resolve(mockLLM);
    });

    const event = {
      data: { type: 'load' }
    } as MessageEvent;

    // Trigger the onmessage handler
    await (self as any).onmessage(event);

    expect(mockPostMessage).toHaveBeenCalledWith({ status: 'loading', message: 'Loading models...' });
    expect(mockPostMessage).toHaveBeenCalledWith({ status: 'ready' });
  });

  it('should trigger progress callbacks', async () => {
    const callbacks: any = {};
    (pipeline as any).mockImplementation((type: string, model: string, options: any) => {
      if (type === 'automatic-speech-recognition') callbacks.stt = options.progress_callback;
      if (type === 'text-generation') callbacks.llm = options.progress_callback;
      return Promise.resolve(vi.fn());
    });

    await (self as any).onmessage({ data: { type: 'load' } } as any);
    
    if (callbacks.stt) {
      callbacks.stt({ status: 'progress', progress: 0.5 });
      expect(mockPostMessage).toHaveBeenCalledWith({ status: 'progress', model: 'stt', progress: 0.5 });
    }
    if (callbacks.llm) {
      callbacks.llm({ status: 'progress', progress: 0.7 });
      expect(mockPostMessage).toHaveBeenCalledWith({ status: 'progress', model: 'llm', progress: 0.7 });
    }
  });

  it('should handle transcribe error', async () => {
    const mockSTT = vi.fn().mockRejectedValue(new Error('Transcribe failed'));
    (pipeline as any).mockResolvedValue(mockSTT);

    await (self as any).onmessage({
      data: { type: 'transcribe', data: { audio: new Float32Array([0]), id: '123' } }
    } as any);

    expect(mockPostMessage).toHaveBeenCalledWith({
      status: 'error',
      error: 'Transcribe failed',
      id: '123',
      task: 'transcribe'
    });
  });

  it('should handle fact-check error', async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error('LLM failed'));
    (pipeline as any).mockResolvedValue(mockLLM);

    await (self as any).onmessage({
      data: { type: 'fact-check', data: { text: 'Statement', id: '123' } }
    } as any);

    expect(mockPostMessage).toHaveBeenCalledWith({
      status: 'error',
      error: 'LLM failed',
      id: '123',
      task: 'fact-check'
    });
  });

  it('should handle transcribe message', async () => {
    const mockSTT = vi.fn().mockResolvedValue({ text: 'Hello world' });
    (pipeline as any).mockResolvedValue(mockSTT);

    const event = {
      data: { type: 'transcribe', data: { audio: new Float32Array([0]), id: '123' } }
    } as MessageEvent;

    await (self as any).onmessage(event);

    expect(mockPostMessage).toHaveBeenCalledWith({
      status: 'transcription',
      text: 'Hello world',
      id: '123'
    });
  });

  it('should handle fact-check message', async () => {
    const mockLLM = vi.fn().mockResolvedValue([{ generated_text: '[True] | Explaining why.' }]);
    (pipeline as any).mockResolvedValue(mockLLM);

    const event = {
      data: { type: 'fact-check', data: { text: 'Statement', id: '123' } }
    } as MessageEvent;

    await (self as any).onmessage(event);

    expect(mockPostMessage).toHaveBeenCalledWith({
      status: 'fact-check-result',
      result: '[True] | Explaining why.',
      id: '123'
    });
  });

  it('should handle errors', async () => {
    (pipeline as any).mockRejectedValue(new Error('Failed to load'));

    const event = {
      data: { type: 'load' }
    } as MessageEvent;

    await (self as any).onmessage(event);

    expect(mockPostMessage).toHaveBeenCalledWith({
      status: 'error',
      error: 'Failed to load'
    });
  });
});
