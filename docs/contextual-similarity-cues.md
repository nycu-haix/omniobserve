# Contextual similarity cue queue

Each participant has an in-memory queue reconstructed from current similarity
pairs and the existing `similarity_cue_events` table. There is no schema migration.

- One pair cue is visible at a time in experimental group/reflect phases.
- Keep the active cue while Now changes. After a successful View, Share, or
  Dismiss, prefer a pending cue for a currently Now-highlighted idea block.
  Otherwise use FIFO order. No automatic dismissal or transition-summary popup.
- A shown, unanswered cue resumes on reload. Terminal responses do not replay.
- Stable IDs use the recipient's own block and the other block, so rerunning
  detection (and replacing similarity rows) does not replay the same pair.
- Deleted pairs are excluded. Distinct pairs on the same block remain distinct.
- Existing item inference, Now lifetime, block highlights and badges are unchanged.

## API

`GET /api/sessions/{session_name}/users/{user_id}/similarity-cues`
returns `cues` (stable cue IDs, pair IDs, block IDs, summary, reason type and
response status) and `nowBlockIds`. It is scoped to that participant's existing
non-deleted pairs. Now targets are read from the existing public context state.

`POST /api/sessions/{session_name}/users/{user_id}/similarity-cues/response`
accepts `{ "cueId": "pair-10-20", "response": "shown" }`, where response is
`shown`, `accepted`, `dismissed` or `shared`. It validates pair ownership and the
current cue condition/phase. PostgreSQL transaction locks serialize writes;
terminal responses are idempotent and cannot regress to shown.

The UI records shown only after display. It waits for HTTP persistence before
advancing View/Dismiss and for WebSocket delivery confirmation before finishing
Share. Failed delivery, failed persistence and missing jump targets keep the cue.
The existing share handler only records success if at least one recipient was
reached. A disconnected client pauses presentation and reloads the queue on return.

The database stores response history, not queue order. A server restart follows
the existing room phase and Now restoration behavior; this feature does not
introduce persistence for those independent room states.

## Validation

- Frontend: `node --test --experimental-strip-types tests/*.test.ts`, TypeScript,
  ESLint, and Vite production build.
- Backend: `PYTHONPATH=backend python -m unittest discover -s backend/tests`.
- Ethel acceptance: isolated test session with synthetic participants, multiple
  pairs and Now changes; confirm one visible cue, manual progression, failed
  share retention, refresh recovery, and no cue in control/private phases.
