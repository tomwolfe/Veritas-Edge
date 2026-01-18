import { pipeline, env } from '@huggingface/transformers';

// Skip local model check
env.allowLocalModels = false;
env.useBrowserCache = true;

// Memory optimization: limit WASM threads if WebGPU is not used or during initialization
env.backends.onnx.wasm.numThreads = 1;

class InferencePipeline {
  static sttInstance: any = null;
  static llmInstance: any = null;
  static sttPromise: Promise<any> | null = null;
  static llmPromise: Promise<any> | null = null;

  static async getSTT(progress_callback: ((progress: any) => void) | null = null) {
    if (this.sttInstance) return this.sttInstance;
    if (this.sttPromise) return this.sttPromise;

    console.log('[Worker] Initializing STT...');
    this.sttPromise = pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
      device: 'webgpu',
      dtype: 'fp32',
      progress_callback: (progress: any) => {
        if (progress_callback) progress_callback(progress);
      },
    }).then(instance => {
      console.log('[Worker] STT Ready');
      this.sttInstance = instance;
      return instance;
    }).catch(err => {
      console.error('[Worker] STT Initialization failed:', err);
      this.sttPromise = null;
      throw err;
    });

    return this.sttPromise;
  }

  static async getLLM(progress_callback: ((progress: any) => void) | null = null) {
    if (this.llmInstance) return this.llmInstance;
    if (this.llmPromise) return this.llmPromise;

    const device = 'webgpu';
    const dtype = 'q4'; // More compatible than q4f16
    
    console.log(`[Worker] Initializing LLM (${device}, ${dtype})...`);

    this.llmPromise = pipeline('text-generation', 'Xenova/Phi-3-mini-4k-instruct', {
      device,
      dtype,
      progress_callback: (progress: any) => {
        if (progress_callback) progress_callback(progress);
      },
    }).then(instance => {
      console.log('[Worker] LLM Ready');
      // Limit internal sequence length if possible to save memory
      if (instance.model && instance.model.config) {
        instance.model.config.max_position_embeddings = 1024;
      }
      this.llmInstance = instance;
      return instance;
    }).catch(err => {
      console.error('[Worker] LLM Initialization failed:', err);
      this.llmPromise = null;
      throw err;
    });

    return this.llmPromise;
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  if (type === 'load') {
    self.postMessage({ status: 'loading', message: 'Loading models...' });
    
    const reportProgress = (model: 'stt' | 'llm') => (progress: any) => {
      if (progress.status === 'progress') {
        self.postMessage({ status: 'progress', model, progress: progress.progress });
      } else if (progress.status === 'initiate') {
        self.postMessage({ status: 'progress', model, progress: 0 });
      } else if (progress.status === 'done') {
        self.postMessage({ status: 'progress', model, progress: 100 });
      }
    };

    try {
      await InferencePipeline.getSTT(reportProgress('stt'));
      await InferencePipeline.getLLM(reportProgress('llm'));
      self.postMessage({ status: 'ready' });
    } catch (error: any) {
      console.error('[Worker] Load error:', error);
      self.postMessage({ status: 'error', error: error.message });
    }
  }

  if (type === 'transcribe') {
    try {
      const stt = await InferencePipeline.getSTT();
      const output = await stt(data.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });
      self.postMessage({ status: 'transcription', text: output.text, id: data.id });
    } catch (error: any) {
      self.postMessage({ status: 'error', error: error.message, id: data.id, task: 'transcribe' });
    }
  }

  if (type === 'fact-check') {
    try {
      const llm = await InferencePipeline.getLLM();
      
      const prompt = `<|system|>
You are a real-time fact-checker. Determine if the following statement contains a verifiable factual claim.
If it is NOT a factual claim (e.g., a greeting, an opinion, a question, or a vague statement), respond ONLY with "NOT_A_CLAIM".
If it IS a factual claim, provide a verdict (True, False, or Unverified) and a brief 1-sentence explanation.
Format: [VERDICT] | [EXPLANATION]
Example: [True] | The Earth orbits the Sun once every 365.25 days.
Maintain objectivity and focus on consensus facts.<|end|>
<|user|>
${data.text}<|end|>
<|assistant|>`;

      const output = await llm(prompt, {
        max_new_tokens: 128,
        temperature: 0,
        do_sample: false,
        return_full_text: false,
      });

      const response = output[0].generated_text.trim();
      self.postMessage({ status: 'fact-check-result', result: response, id: data.id });
    } catch (error: any) {
      self.postMessage({ status: 'error', error: error.message, id: data.id, task: 'fact-check' });
    }
  }
};

