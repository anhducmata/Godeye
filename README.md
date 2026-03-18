# 🧠 GodEye — AI Meeting Intelligence

> Record, transcribe, summarize, and search your meetings with AI — all running locally on your desktop.

![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=flat&logo=electron&logoColor=9FEAF9)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat&logo=openai&logoColor=white)

## ✨ Features

### 🎙️ Recording & Capture
- **System Audio + Microphone** recording with real-time controls
- **Screen Recording** with custom area selection (or full screen)
- **Live screen capture preview** during recording
- **WebM audio recording** saved locally

### 📝 Real-Time Transcription
- **Dual-engine transcription** — Web Speech API (instant) + OpenAI Whisper (accurate)
- **Voice Activity Detection (VAD)** for intelligent audio segmentation
- **Multi-language support** — English, Vietnamese, Spanish, and more

### 🤖 AI Summarization
- **Live summaries** generated every 15-60 seconds during recording
- **Statements & Facts extraction** — key points, decisions, and follow-ups
- **Document Mode** — generates a comprehensive, formatted document with diagrams
- **Configurable AI models** — GPT-4o-mini for fast updates, GPT-4o for deep analysis

### 🔍 Screen OCR
- **Automatic OCR** on captured screen frames using Tesseract.js
- **Visual notes** — extracted text from screen content enriches the meeting context
- Full-resolution capture for accurate text recognition

### 💬 AI Chat
- **Session-aware chat** — ask questions about any specific past meeting
- **Cross-session search** — search across all meetings with full-text and semantic search
- **RAG-powered** — answers grounded in actual meeting transcripts and summaries

### ☁️ Cloud Storage & Sync
- **S3 integration** — screen capture frames uploaded to AWS S3
- **PostgreSQL (Neon)** — sessions, transcripts, summaries stored in the cloud
- **OpenAI Vector Store** — sessions indexed for semantic search

### 🏷️ Organization
- **Tags & Categories** — organize sessions with custom tags
- **Speaker Profiles** — assign and track speakers across sessions
- **Auto-titling** — AI generates session titles from content
- **Paste Memory** — paste any text for AI analysis and storage

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│              Electron App               │
├──────────────────┬──────────────────────┤
│   Renderer       │      Main Process    │
│                  │                      │
│  React UI        │  ScreenCapturer      │
│  useCapture()    │  AudioCapturer       │
│  useTranscript() │  WhisperTranscriber  │
│  ChatWidget      │  SummaryEngine       │
│  Sidebar         │  OcrPipeline         │
│                  │  IPC Handlers        │
├──────────────────┴──────────────────────┤
│            Preload (IPC Bridge)         │
├─────────────────────────────────────────┤
│           External Services             │
│  OpenAI API · PostgreSQL · AWS S3       │
└─────────────────────────────────────────┘
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- OpenAI API key
- PostgreSQL database (Neon recommended)
- AWS S3 bucket (optional, for frame storage)

### Setup

```bash
# Clone
git clone https://github.com/anhducmata/Godeye.git
cd Godeye

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Run in development
npm run dev

# Build for production
npm run build
```

### Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key for transcription & summarization |
| `DATABASE_URL` | PostgreSQL connection string |
| `AWS_ACCESS_KEY_ID` | AWS credentials for S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for S3 |
| `AWS_REGION` | AWS region (e.g., `ap-southeast-1`) |
| `S3_BUCKET` | S3 bucket name for frame storage |

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | Electron |
| Frontend | React + TypeScript |
| Styling | Vanilla CSS (dark theme) |
| AI / LLM | OpenAI GPT-4o, GPT-4o-mini |
| Transcription | OpenAI Whisper + Web Speech API |
| OCR | Tesseract.js |
| Database | PostgreSQL (Neon) |
| Storage | AWS S3 |
| Search | OpenAI Vector Store (RAG) |

## 📄 License

MIT
