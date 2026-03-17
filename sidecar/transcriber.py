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

    def transcribe_chunk(self, audio_data: np.ndarray, sr: int = 16000) -> list[dict]:
        """
        Transcribe an audio chunk (numpy float32 array).
        Returns list of segments: [{text, start, end}]
        """
        # Append to buffer
        self._buffer = np.concatenate([self._buffer, audio_data])
        
        # Only transcribe if we have enough audio
        duration = len(self._buffer) / sr
        if duration < self._min_chunk_duration:
            return []

        try:
            segments, info = self.model.transcribe(
                self._buffer,
                beam_size=1,
                best_of=1,
                language=None,  # Auto-detect
                vad_filter=True,
                vad_parameters=dict(
                    min_silence_duration_ms=300,
                    speech_pad_ms=200
                )
            )

            results = []
            for segment in segments:
                text = segment.text.strip()
                if text and text not in [".", "...", "[BLANK_AUDIO]", "(music)"]:
                    results.append({
                        "text": text,
                        "start": round(segment.start, 2),
                        "end": round(segment.end, 2),
                        "language": info.language if info else "unknown"
                    })

            # Clear buffer after successful transcription
            self._buffer = np.array([], dtype=np.float32)
            return results

        except Exception as e:
            print(f"[Transcriber] Error: {e}")
            # Keep buffer, try again next time
            return []

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
