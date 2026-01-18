import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import DebateLens from './DebateLens';
import { useAudioProcessor } from '@/hooks/useAudioProcessor';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/hooks/useAudioProcessor', () => ({
  useAudioProcessor: vi.fn(),
}));

// Mock Worker
class MockWorker {
  onmessage: (e: any) => void = () => {};
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe('DebateLens', () => {
  let mockWorkerInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    class MockWorker {
      onmessage: (e: any) => void = () => {};
      postMessage = vi.fn();
      terminate = vi.fn();
      constructor() {
        mockWorkerInstance = this;
      }
    }

    vi.stubGlobal('Worker', MockWorker);
    
    (useAudioProcessor as any).mockReturnValue({
      vad: {
        loading: false,
        errored: false,
        listening: true,
        userSpeaking: false,
        pause: vi.fn(),
        start: vi.fn(),
      },
    });

    // Mock localStorage
    const localStorageMock = (function() {
      let store: any = {};
      return {
        getItem: vi.fn((key) => store[key] || null),
        setItem: vi.fn((key, value) => { store[key] = value.toString(); }),
        clear: vi.fn(() => { store = {}; }),
        removeItem: vi.fn((key) => { delete store[key]; }),
      };
    })();
    vi.stubGlobal('localStorage', localStorageMock);

    // Mock navigator.mediaDevices and clipboard
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'dev1', label: 'Mic 1', kind: 'audioinput' },
        ]),
      },
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Mock window.confirm
    vi.stubGlobal('confirm', vi.fn(() => true));
    
    // Mock window.alert
    vi.stubGlobal('alert', vi.fn());
  });

  it('renders initializing state initially', () => {
    render(<DebateLens />);
    expect(screen.getByText(/Initializing DebateLens/i)).toBeInTheDocument();
  });

  it('transitions to ready state when worker is ready', async () => {
    render(<DebateLens />);
    
    // Simulate worker ready
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Debate/i })).toBeInTheDocument();
    });
  });

  it('switches speakers when buttons are clicked', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    const speakerBButton = await screen.findByText(/Speaker B/i);
    fireEvent.click(speakerBButton);

    expect(speakerBButton).toHaveClass('bg-red-600');
  });

  it('handles transcription from worker', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    // Simulate transcription (must be > 2 words)
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { 
          status: 'transcription', 
          text: 'This is a test claim.', 
          id: 'test-id' 
        } 
      });
    });

    expect(await screen.findByText('This is a test claim.')).toBeInTheDocument();
    expect(screen.getByText(/Analyzing Claim.../i)).toBeInTheDocument();
  });

  it('handles fact-check stream from worker', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    // Transcription first
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'Water is wet and cold.', id: '123' } 
      });
    });

    // Fact check stream
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { 
          status: 'fact-check-stream', 
          text: '[True] Yes, water is wet.', 
          id: '123',
          isDone: true
        } 
      });
    });

    expect(await screen.findByText('True')).toBeInTheDocument();
    expect(screen.getByText('Yes, water is wet.')).toBeInTheDocument();
  });

  it('clears feed when trash button is clicked', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'To be cleared soon.', id: '123' } 
      });
    });

    const clearButton = await screen.findByTitle('Clear Feed');
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(screen.queryByText('To be cleared soon.')).not.toBeInTheDocument();
    });
  });

  it('copies transcript to clipboard', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'Copy me now.', id: '123' } 
      });
    });

    const copyButton = await screen.findByTitle('Copy Transcript');
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
  });

  it('handles keyboard shortcuts', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    // Switch to Speaker B with '2'
    fireEvent.keyDown(window, { key: '2' });
    expect(screen.getByText(/Speaker B/i)).toHaveClass('bg-red-600');

    // Toggle listening with 'm'
    const { vad } = (useAudioProcessor as any).mock.results[0].value;
    fireEvent.keyDown(window, { key: 'm' });
    expect(vad.pause).toHaveBeenCalled();

    // Clear feed with 'ctrl+c'
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true });
    expect(vi.mocked(confirm)).toHaveBeenCalled();
  });

  it('handles progress updates', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'progress', model: 'stt', progress: 50 } 
      });
    });

    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('handles global worker errors', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'error', error: 'Critical failure' } 
      });
    });
    
    expect(screen.getByText('Critical failure')).toBeInTheDocument();
  });

  it('triggers onSpeechEnd and posts message to worker', async () => {
    render(<DebateLens />);
    const onSpeechEnd = (useAudioProcessor as any).mock.calls[0][0];
    
    const audio = new Float32Array([1, 2, 3]);
    await act(async () => {
      onSpeechEnd(audio);
    });

    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcribe',
        data: expect.objectContaining({ audio })
      }),
      expect.any(Array)
    );
  });

  it('handles per-transcript errors', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'Error prone text here.', id: 'err-1' } 
      });
    });

    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'error', id: 'err-1', task: 'fact-check', error: 'API Timeout' } 
      });
    });

    expect(await screen.findByText(/Error: API Timeout/i)).toBeInTheDocument();
  });

  it('robustly parses different fact-check formats', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    // Format: Verdict: Explanation
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'Format 1 is here.', id: 'f1' } 
      });
      mockWorkerInstance.onmessage({ 
        data: { status: 'fact-check-stream', text: 'False: That is not right.', id: 'f1', isDone: true } 
      });
    });
    expect(await screen.findByText('False')).toBeInTheDocument();
    expect(screen.getByText('That is not right.')).toBeInTheDocument();

    // Format: Just text with keyword
    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'Format 2 is here.', id: 'f2' } 
      });
      mockWorkerInstance.onmessage({ 
        data: { status: 'fact-check-stream', text: 'This is true because reasons.', id: 'f2', isDone: true } 
      });
    });
    expect(await screen.findByText('True')).toBeInTheDocument();
  });

  it('loads transcripts from localStorage on mount', async () => {
    const savedTranscripts = [{ id: 'saved-1', text: 'Saved text is long.', speaker: 'A', isChecking: false, timestamp: Date.now() }];
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(savedTranscripts));
    
    render(<DebateLens />);
    
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });
    
    expect(await screen.findByText('Saved text is long.')).toBeInTheDocument();
  });

  it('handles localStorage parse error', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('invalid-json');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<DebateLens />);
    
    expect(consoleSpy).toHaveBeenCalledWith('Failed to parse saved transcripts', expect.any(Error));
    consoleSpy.mockRestore();
  });

  it('handles the final parsing fallback', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    await act(async () => {
      mockWorkerInstance.onmessage({ 
        data: { status: 'transcription', text: 'Fallback test is here.', id: 'fb-1' } 
      });
      mockWorkerInstance.onmessage({ 
        data: { status: 'fact-check-stream', text: 'Completely weird response', id: 'fb-1', isDone: true } 
      });
    });
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
  });

  it('handles manual text submission', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    const textarea = screen.getByPlaceholderText(/Enter text to fact-check as Speaker A/i);
    fireEvent.change(textarea, { target: { value: 'This is a manual test claim.' } });

    const submitButton = screen.getByText('Submit for Fact-Check');
    fireEvent.click(submitButton);

    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'fact-check',
        data: expect.objectContaining({ text: 'This is a manual test claim.' })
      })
    );
  });

  it('does not submit manual text with less than 3 words', async () => {
    render(<DebateLens />);
    await act(async () => {
      mockWorkerInstance.onmessage({ data: { status: 'ready' } });
    });

    const textarea = screen.getByPlaceholderText(/Enter text to fact-check as Speaker A/i);
    fireEvent.change(textarea, { target: { value: 'Too short' } });

    const submitButton = screen.getByText('Submit for Fact-Check');
    fireEvent.click(submitButton);

    // The worker should not receive a fact-check message for text with less than 3 words
    const postMessageCalls = (mockWorkerInstance.postMessage as any).mock.calls;
    const factCheckCalls = postMessageCalls.filter((call: any) => call[0].type === 'fact-check');
    expect(factCheckCalls).toHaveLength(0);
  });
});