# MeetSense

**Conversation Intelligence Platform** — AI-powered meeting transcription, summarization, and knowledge linking.

## What it does

MeetSense captures audio during meetings, generates real-time transcriptions and AI summaries, then produces a rich speaker-aware document with linked knowledge from past sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  @meetsense/core (shared TypeScript)                    │
│  ├─ Transcription Pipeline (gpt-4o-mini-transcribe)     │
│  ├─ Summary Engine (gpt-4o-mini rolling, gpt-5.4-mini)  │
│  ├─ Post-Meeting (diarize → final summary)              │
│  ├─ PostgreSQL Client                                   │
│  ├─ S3 Storage (audio archive)                          │
│  ├─ OpenAI RAG (Vector Store + file_search)             │
│  └─ Fine-tuning Pipeline                                │
├─────────────────────────────────────────────────────────┤
│  Desktop: Electron + React                              │
│  Mobile:  React Native + Expo (Phase 2)                 │
└─────────────────────────────────────────────────────────┘
```

## Model Strategy

| Stage | Model | Cost |
|---|---|---|
| Live transcription | `gpt-4o-mini-transcribe` | $0.003/min |
| Suspicious retry | `gpt-4o-transcribe` | $0.006/min |
| Rolling summary (15s) | `gpt-4o-mini` | $0.15/1M input |
| Post-meeting diarize | `gpt-4o-transcribe-diarize` | $0.006/min |
| Final summary | `gpt-5.4-mini` | $0.75/1M input |
| **Est. cost per hour** | | **~$0.75** |

## Tech Stack

- **Runtime**: Electron (desktop), React Native + Expo (mobile, Phase 2)
- **Frontend**: React 19, Vanilla CSS, ReactMarkdown, Mermaid.js
- **Database**: PostgreSQL via `pg`
- **Storage**: AWS S3 via `@aws-sdk/client-s3`
- **AI**: OpenAI API (transcription, summarization, diarization, RAG, fine-tuning)

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your keys:
#   OPENAI_API_KEY=sk-...
#   DATABASE_URL=postgresql://user:pass@host:5432/meetsense
#   S3_ACCESS_KEY=AKIA...
#   S3_SECRET_VALUE=...
#   S3_BUCKET=meetsense-sessions
#   S3_REGION=us-east-1

# Create database
psql -c "CREATE DATABASE meetsense;"

# Run in development
npm run dev

# Build for production
npm run build
```

## Project Structure

```
src/
├── main/                  # Electron main process
│   ├── db/                # PostgreSQL client + CRUD
│   ├── storage/           # S3 upload/download
│   ├── pipeline/          # Transcription + summary engines
│   ├── rag/               # OpenAI Vector Store + search
│   ├── finetune/          # Fine-tuning data pipeline
│   ├── ipc/               # IPC handlers
│   └── index.ts           # App entry
├── renderer/              # React UI
│   ├── components/        # Sidebar, TagManager, KnowledgePanel
│   ├── hooks/             # useCapture, useTranscript
│   ├── styles/            # CSS theme
│   └── App.tsx            # Main app
└── preload/               # Electron preload bridge
```

## Features

- 🎙️ **Real-time transcription** with pause-based chunking (4-12s)
- 🧠 **AI summaries** every 15s (statements, questions, document)
- 🗣️ **Speaker diarization** after meeting ends
- 📄 **Auto-detect document type** (standup, planning, feedback, retro, brainstorm)
- 🏷️ **Tags** for organizing sessions
- 🔗 **RAG knowledge linking** — surface related facts from past meetings
- 📦 **S3 audio archive** — re-process with future models
- 🎯 **Fine-tuning** — summaries improve with your meeting style over time
- 📱 **Mobile support** (Phase 2) with iOS background recording

## License

Private — All rights reserved.
