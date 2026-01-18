import { useMicVAD } from "@ricky0123/vad-react";

export function useAudioProcessor(onSpeechEnd: (audio: Float32Array) => void) {
  const vad = useMicVAD({
    // @ts-expect-error - vad-react types are missing baseAssetPath
    baseAssetPath: "/",
    // @ts-expect-error - vad-react types are missing onnxWASMBasePath
    onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/",
    // @ts-expect-error - vad-react types are missing model
    model: "v5",
    onSpeechEnd: (audio) => {
      onSpeechEnd(audio);
    },
  });

  return {
    isRecording: !vad.loading && !vad.errored,
    vad,
  };
}
