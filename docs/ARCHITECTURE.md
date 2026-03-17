# MeetSense Architecture

## Data Flow

### During Recording (Live Path)

```
Microphone/System Audio
    │
    ▼
AudioContext (16kHz PCM)──────► WebM MediaRecorder
    │                              │
    ├─ 4-12s chunks                └─ Local temp file
    ▼
gpt-4o-mini-transcribe ($0.003/min)
    │
    ├─ Suspicious? ──► gpt-4o-transcribe retry ($0.006/min)
    │
    ▼
Transcript Buffer
    │
    └─ Every 15s ──► gpt-4o-mini ($0.15/1M)
                        │
                        ▼
                    {statements, questions, docType, documentSummary}
                        │
                        └──► React UI (3-column display)
```

### After Recording (Post-Meeting Path)

```
Stop Capture
    │
    ├──────────────────┬────────────────────┐
    ▼                  ▼                    ▼
Upload WebM        Save session         Diarize audio
to S3              to PostgreSQL        gpt-4o-transcribe-diarize
                                            │
                                            ▼
                                   Diarized transcript
                                   (speakers + timestamps)
                                            │
                        ┌───────────────────┤
                        ▼                   ▼
                  Final Summary         RAG Search
                  gpt-5.4-mini         (file_search)
                        │                   │
            ┌───────────┼───────────┐       └──► Related facts
            ▼           ▼           ▼
        Vector       Fine-tune    Save to
        Store        queue        PostgreSQL
        upload       (JSONL)
```

## Document Types

MeetSense auto-detects the meeting type and adapts the summary format:

| Type | Template | Detected When |
|---|---|---|
| `standup` | What I did, blockers, plan | Short, status-update style |
| `planning` | Goals, tasks, timeline, owners | Sprint/project planning discussion |
| `feedback` | Observations, suggestions, action items | Review/feedback conversation |
| `retrospective` | Went well, went wrong, improvements | Retro-style discussion |
| `brainstorm` | Ideas, themes, categories, votes | Free-form ideation |
| `general` | Full meeting minutes | Default fallback |

## Database Schema

```
sessions ─────┬──── transcripts
              ├──── summaries
              └──── session_tags ──── tags

finetune_queue (linked to sessions)
```

## Cost Tracking

Each session records its total API cost in cents in the `sessions.cost_cents` column.
This enables:
- Per-session cost visibility in the UI
- Monthly cost aggregation
- Optimization insights (which meeting types cost more)
