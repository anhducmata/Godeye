"""
Real-time audio transcription using faster-whisper.
Wraps the WhisperModel with chunk-based transcription and VAD filtering.
"""

import io
import numpy as np
from faster_whisper import WhisperModel


class RealtimeTranscriber:
    """Transcribes audio chunks using faster-whisper with VAD."""

    def __init__(self, model_size: str = "base", device: str = "cpu", compute_type: str = "int8"):
        print(f"[Transcriber] Loading model: {model_size} on {device} ({compute_type})")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        print(f"[Transcriber] Model loaded successfully")
        self._buffer = np.array([], dtype=np.float32)
        self._min_chunk_duration = 1.0  # Minimum seconds before transcribing
        self._sample_rate = 16000

    def transcribe_chunk(self, audio_data: np.ndarray, sr: int = 16000) -> tuple[list[dict], bool]:
        """
        Transcribe an audio chunk (numpy float32 array).
        Returns (segments, is_final): 
          segments: list of [{text, start, end, language}]
          is_final: True if silence detected, False if interim
        """
        # Append to buffer
        self._buffer = np.concatenate([self._buffer, audio_data])
        
        # Only transcribe if we have enough audio
        duration = len(self._buffer) / sr
        if duration < self._min_chunk_duration:
            return [], False

        # Check overall energy to prevent hallucinating on pure background noise
        # 16-bit audio normalized to [-1, 1], RMS gives the average energy
        rms_energy = np.sqrt(np.mean(np.square(self._buffer)))
        if rms_energy < 0.005:
            # The entire buffer is too quiet, skip transcribing to prevent hallucination
            if duration > 5.0:
                self.reset()
            return [], False

        # Detect silence in the most recent audio to decide if it's "final"
        is_final = False
        
        # We consider it final if there's been ~0.5s of silence at the end, 
        # or if the buffer is getting too long (>15 seconds forces a break).
        if duration > 15.0:
            is_final = True
        elif duration > 1.0:
            # Check last 0.5s for silence (naive energy-based VAD)
            recent_audio = self._buffer[-int(0.5 * sr):]
            energy = np.mean(np.abs(recent_audio))
            if energy < 0.01:  # Stricter threshold for ending a chunk
                is_final = True

        try:
            segments, info = self.model.transcribe(
                self._buffer,
                beam_size=1,
                best_of=1,
                language=None,  # Auto-detect
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                    speech_pad_ms=400
                ),
                condition_on_previous_text=False,
                temperature=0.0,
                no_speech_threshold=0.6,
                logprob_threshold=-0.8,
                compression_ratio_threshold=2.0
            )

            results = []
            blacklist = ["đăng ký kênh", "like và subscribe", "ủng hộ kênh", "ghiền mì gõ"]
            for segment in segments:
                text = segment.text.strip()
                text_lower = text.lower()
                
                if not text or text in [".", "...", "[BLANK_AUDIO]", "(music)"]:
                    continue
                    
                if any(phrase in text_lower for phrase in blacklist):
                    continue
                    
                results.append({
                    "text": text,
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "language": info.language if info else "unknown"
                })

            if is_final:
                # Clear buffer after successful final transcription
                self._buffer = np.array([], dtype=np.float32)

            return results, is_final

        except Exception as e:
            print(f"[Transcriber] Error: {e}")
            # Keep buffer, try again next time
            return [], False

    def reset(self):
        """Clear the audio buffer."""
        self._buffer = np.array([], dtype=np.float32)


if __name__ == "__main__":
    # Quick test
    transcriber = RealtimeTranscriber(model_size="tiny")
    # Generate silence (1 second)
    silence = np.zeros(16000, dtype=np.float32)
    results = transcriber.transcribe_chunk(silence)
    print(f"Test results (silence): {results}")
    print("Transcriber initialized successfully!")
