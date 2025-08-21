# GPT deadline

A minimal PWA to track your ChatGPT Plus billing cycle with a progress ring, live countdown, timeline, milestones, reminders, and .ics export.

## Quick start
```bash
npm i
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Notes
- Timezone fixed to `Asia/Kathmandu` by default (you can change in Settings).
- Reminders use local Notifications and in-app toasts; they auto-dismiss after a few seconds.
- Works offline via a lightweight service worker.
