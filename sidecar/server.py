"""
WebSocket server for real-time speech-to-text.
Receives binary PCM audio chunks from the Electron main process,
transcribes them using faster-whisper, and returns JSON results.

Protocol:
- Client sends: binary 16-bit PCM audio at 16kHz mono
- Server responds: JSON array of {text, start, end, language}
- Server sends "ping" every 5s as heartbeat
- Client can send text "reset" to clear buffer
"""

import asyncio
import json
import sys
import signal
import base64
import numpy as np
import websockets
import io
import scipy.io.wavfile as wav
from transcriber import RealtimeTranscriber


# Configuration
HOST = "localhost"
PORT = 9876
MODEL_SIZE = "base"  # tiny, base, small, medium, large-v3
DEVICE = "cpu"       # cpu or cuda


async def handle_client(websocket):
    """Handle a single WebSocket client connection."""
    print(f"[Server] Client connected from {websocket.remote_address}")
    transcriber = RealtimeTranscriber(model_size=MODEL_SIZE, device=DEVICE)
    
    try:
        async for message in websocket:
            # Text commands
            if isinstance(message, str):
                if message == "reset":
                    transcriber.reset()
                    await websocket.send(json.dumps({"type": "reset", "status": "ok"}))
                elif message == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
                continue

            # Binary audio data (16-bit PCM, 16kHz, mono)
            audio = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
            
            results, is_final = transcriber.transcribe_chunk(audio, sr=16000)
            
            if results:
                # Convert the float32 numpy array back to 16-bit PCM for the WAV file
                audio_int16 = (audio * 32767).astype(np.int16)
                
                # Write to in-memory bytes buffer
                buf = io.BytesIO()
                wav.write(buf, 16000, audio_int16)
                wav_bytes = buf.getvalue()
                audio_b64 = base64.b64encode(wav_bytes).decode('utf-8')
                
                response = json.dumps({
                    "type": "transcription",
                    "segments": results,
                    "is_final": is_final,
                    "audioBase64": audio_b64
                })
                await websocket.send(response)

    except websockets.exceptions.ConnectionClosed:
        print(f"[Server] Client disconnected")
    except Exception as e:
        print(f"[Server] Error: {e}")
    finally:
        transcriber.reset()


async def heartbeat(websocket):
    """Send periodic heartbeat to keep connection alive."""
    try:
        while True:
            await asyncio.sleep(5)
            await websocket.send(json.dumps({"type": "heartbeat"}))
    except (websockets.exceptions.ConnectionClosed, Exception):
        pass


async def main():
    print(f"[Server] Starting ASR server on ws://{HOST}:{PORT}")
    print(f"[Server] Model: {MODEL_SIZE}, Device: {DEVICE}")
    
    # Handle graceful shutdown
    stop = asyncio.Future()
    
    def signal_handler():
        if not stop.done():
            stop.set_result(None)
    
    loop = asyncio.get_event_loop()
    for sig in [signal.SIGTERM, signal.SIGINT]:
        try:
            loop.add_signal_handler(sig, signal_handler)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    async with websockets.serve(
        handle_client,
        HOST,
        PORT,
        max_size=10 * 1024 * 1024,  # 10MB max message size
        ping_interval=10,
        ping_timeout=30
    ):
        print(f"[Server] ASR server running on ws://{HOST}:{PORT}")
        print(f"[Server] Ready to receive audio data")
        sys.stdout.flush()
        
        try:
            await stop
        except asyncio.CancelledError:
            pass

    print("[Server] Shutting down")


if __name__ == "__main__":
    asyncio.run(main())
