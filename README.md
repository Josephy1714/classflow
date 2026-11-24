# CLASSFLOW

**Your entire academic life, organized in one place.**

CLASSFLOW is a mobile-first academic timetable and semester workspace built with React and Vite. The current MVP is designed for students worldwide and stores academic records locally in the browser.

## Current features
- Overview dashboard with semester counts and upcoming classes.
- Seven-day timetable (Monday–Sunday), including session creation, editing and deletion.
- Automatic overlap detection for classes scheduled at the same time.
- Unit management and assignment tracking.
- Attendance page for recording present/absent status.
- Timetable import for CSV, XLS/XLSX, ODS, ODT, PDF, PNG, JPG/JPEG and WEBP.
- PDF text extraction with scanned-PDF OCR fallback; image OCR uses Tesseract.js in the browser.
- Import review screen: edit detected unit, day, times and venue or remove rows before importing.
- JSON backup export and restore.
- Installable PWA foundation and service-worker receiver for Web Push notifications.

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

GitHub Actions runs the production build on pushes and pull requests to `main`.

## Important limitations
- Timetable extraction is heuristic. Always review the imported rows; unusual layouts may need manual entry.
- Academic records are stored in browser local storage. Clearing browser data can remove them; export a JSON backup regularly.
- The service worker can display incoming Web Push messages, but the project does not yet include a push sender, subscription database, VAPID secrets or scheduler. It therefore does not promise reminders while the browser is closed.
- This is an MVP, not a finished production SaaS. Authentication, cloud sync, automated closed-browser reminders and a full exam workflow remain future work.

## Privacy
OCR runs client-side in the browser. No academic data is sent to a CLASSFLOW backend in this MVP.