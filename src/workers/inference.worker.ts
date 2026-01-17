import { pipeline, env, AutoTokenizer } from '@huggingface/transformers';

// Skip local model check
env.allowLocalModels = false;
env.useBrowserCache = true;

class InferencePipeline {
  static sttInstance: any = null;
  static llmInstance: any = null;

  static async getSTT(progress_callback: any) {
    if (this.sttInstance === null) {
      this.sttInstance = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny.en', {
        device: 'webgpu',
        dtype: 'fp32',
        progress_callback,
      });
    }
    return this.sttInstance;
  }

  static async getLLM(progress_callback: any) {
    if (this.llmInstance === null) {
      this.llmInstance = await pipeline('text-generation', 'Xenova/Phi-3-mini-4k-instruct', {
        device: 'webgpu',
        dtype: 'q4', // 4-bit quantization
        progress_callback,
      });
    }
    return this.llmInstance;
  }
}

self.onmessage = async (e) => {
  const { type, data } = e.data;

  if (type === 'load') {
    self.postMessage({ status: 'loading', message: 'Loading models...' });
    try {
      await InferencePipeline.getSTT((progress: any) => {
        if (progress.status === 'progress') {
          self.postMessage({ status: 'progress', model: 'stt', progress: progress.progress });
        }
      });
      await InferencePipeline.getLLM((progress: any) => {
        if (progress.status === 'progress') {
          self.postMessage({ status: 'progress', model: 'llm', progress: progress.progress });
        }
      });
      self.postMessage({ status: 'ready' });
    } catch (error: any) {
      self.postMessage({ status: 'error', error: error.message });
    }
  }

  if (type === 'transcribe') {
    try {
      const stt = await InferencePipeline.getSTT(null);
      const output = await stt(data.audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true,
      });
      self.postMessage({ status: 'transcription', text: output.text, id: data.id });
    } catch (error: any) {
      self.postMessage({ status: 'error', error: error.message });
    }
  }

  if (type === 'fact-check') {
    try {
      const llm = await InferencePipeline.getLLM(null);
      
      const prompt = `<|system|>
You are a real-time fact-checker. Determine if the following statement contains a verifiable factual claim. If it does, provide a very brief verdict (True, False, or Unverified) and a 1-sentence explanation. If it's not a factual claim, respond with "NOT_A_CLAIM".<|end|>
<|user|>
${data.text}<|end|>
<|assistant|>`;

      const output = await llm(prompt, {
        max_new_tokens: 100,
        temperature: 0.1,
        do_sample: false,
      });

      const response = output[0].generated_text.split('Assistant:').pop().trim();
      self.postMessage({ status: 'fact-check-result', result: response, id: data.id });
    } catch (error: any) {
      self.postMessage({ status: 'error', error: error.message });
    }
  }
};
