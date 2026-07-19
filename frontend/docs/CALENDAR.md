# Google Calendar sync

Two-way sync between task due dates and a user's Google Calendar. Tasks with a due date become all-day events; editing the event in Google flows back to the task. Refresh tokens are stored server-side only (`calendarConnections/{uid}`, never readable by the client).

## How it works

- **Push (task -> Google):** on create/rename/reschedule/delete of a task with a due date, the client fires `/api/calendar/push`, which creates/updates/deletes the event. The Google event id is stored on the task (`googleEventId`); the task id is stored in the event's private extended properties.
- **Pull (Google -> task):** `/api/calendar/webhook` receives Google push notifications (watch channel) and runs an incremental sync (`syncToken`). Only events we created (they carry `sbTaskId`) are touched, so arbitrary calendar events are never imported. "Sync now" (`/api/calendar/sync`) does a full push of all dated tasks then a pull.
- **Scope:** `calendar.events` only. All-day events (`start.date`); end date is exclusive (+1 day).

## One-time setup (Google Cloud console)

Project: **second-brain-fbf414**.

1. **Enable the API** — [console.cloud.google.com/apis/library/calendar-json.googleapis.com](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com?project=second-brain-fbf414) -> Enable.
2. **OAuth consent screen** — APIs & Services -> OAuth consent screen. User type **External**, fill the app name + your email. Under **Test users**, add your Google address (test mode works immediately for you with no verification). Add scope `.../auth/calendar.events` if prompted.
3. **Create credentials** — APIs & Services -> Credentials -> Create credentials -> **OAuth client ID** -> **Web application**. Add Authorised redirect URI:
   ```
   http://localhost:3000/api/calendar/callback
   ```
   Copy the client ID and secret.
4. **Set env** in `.env.local`, then restart `npm run dev`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/calendar/callback
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

## Connect

Open the **Calendar** tab. A "Connect Google Calendar" chip appears (top right). Click it, consent, and you're returned to the app. It runs an initial sync (pushes your dated tasks). After that, edits push automatically and "Sync now" pulls changes back.

## Live reverse-sync (optional)

Automatic Google -> task updates use a **watch channel** that calls a public HTTPS webhook. On localhost that needs a tunnel:

```bash
cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
```

Set the public URL and reconnect:
```
CALENDAR_WEBHOOK_URL=https://<your-tunnel>/api/calendar/webhook
```
Restart, then disconnect + reconnect the calendar so the channel registers against the new URL. Without this, push + "Sync now" still work; only the automatic reverse direction is off (the chip shows "Synced" rather than "Synced (live)"). On a deployed instance, set `CALENDAR_WEBHOOK_URL` to `https://<your-domain>/api/calendar/webhook`.

## Notes

- Watch channels expire (~7 days); a production deployment should re-register them on a schedule. For local/testing use, reconnect when needed.
- Publishing the OAuth app (beyond test users) triggers Google's sensitive-scope review, which can take weeks. Start that early if you go public.
