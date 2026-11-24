# CLASSFLOW

**Your entire academic life, organized in one place.**

A mobile-first academic workspace built with React and Vite. The current MVP stores student data locally in the browser; cloud accounts and synchronization are intentionally deferred.

## Included
- Overview dashboard, seven-day weekly timetable, units, assignments, examinations and attendance.
- Editable class sessions (unit, day, type, start/end time and venue), with overlap detection and delete controls.
- Attendance confirmation with four absence reasons; absence reason is stored separately from attendance status.
- Timetable import for CSV, XLS/XLSX, ODS, ODT, PDF, PNG, JPG/JPEG and WEBP.
- PDF text extraction with scanned-PDF OCR fallback; image OCR uses Tesseract.js in the browser.
- Extracted timetable rows are heuristically recognized and should be checked by the student. Unusual layouts may need manual correction.
- Local browser persistence and JSON backup/restore.
- Installable PWA foundation, service worker notification click handling and Web Push event receiver.
- In-app scheduled attendance prompts while the app is open; browser notifications when permission is granted.

## Current MVP notes
- The timetable displays Monday through Sunday on desktop and a responsive seven-day grid on mobile.
- Imported sessions open in a review step before they are saved.
- The starter workspace contains sample data; replace it with your own details in Workspace settings and the timetable before relying on it.
- This is an MVP, not a finished production SaaS. Dependencies/build have not yet been verified in this environment.

## Run locally
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
npm run preview
```

## Notification delivery: important limitation
The service worker can display Web Push messages and handle notification clicks. The app can schedule attendance reminders while its page is running. **A service worker cannot reliably wake itself at an arbitrary future class-end time when the browser is closed.** True closed-browser automated delivery requires a push sender (for example, a Vercel serverless function with VAPID keys), a persistent subscription store and a scheduler/cron service. Those credentials and a persistent backend are not available in this repository yet, so closed-browser delivery is not represented as complete. Browser/OS settings also control external notification sound behavior.

## Data and privacy
All academic records currently remain in the browser's local storage. Clearing browser data can remove them; export a JSON backup regularly. OCR runs client-side. Cloud accounts and cross-device synchronization are out of scope for this first iteration.