# miiwish

Miiwish is a private wishlist app for sharing gift ideas without the usual chaos of duplicate presents.

## How it works for a user

1. A guest opens the wishlist.
2. They enter their name to request access.
3. The request appears in the admin area and waits for approval.
4. Once approved, the guest can see the items and reserve one.
5. Reserved items are marked so nobody else picks the same gift.
6. If the item is released again, it can be reserved by someone else.

## How it works for the admin

1. The admin opens the secret admin login.
2. They sign in with their Firebase Auth account.
3. They can approve or deny access requests.
4. They can add new wishlist items manually or by pasting a product URL.
5. The app extracts title, image, description and price when possible.
6. They can remove items or toggle the reserved state.

## Main flow

- Visitors can request access to the private wishlist.
- The admin decides whether they may view it.
- Approved users can browse the items and reserve them.
- The app keeps the list private and social without exposing the admin password in the frontend.

## Project status

This project is a lightweight static web app with Firebase for auth and data storage.
The frontend is intentionally simple and designed to be hosted as a static site while the real access control is handled by Firebase Authentication and Firestore rules.

## Important security note

The admin login is not checked by a hardcoded password in the browser. Authentication is handled by Firebase Auth, and write access is protected by Firestore rules. The public frontend should never contain sensitive admin credentials.

---

## Deployment guide

This project is a static frontend and uses Firebase only in the browser for authentication and Firestore access. That means the deployment is split into two parts:

1. GitHub Actions generates the runtime configuration using repository secrets.
2. The static site is deployed and the generated config is available in the browser.

### Why GitHub Secrets are required

The Firebase SDK config is not secret in the sense of a password, but it is environment-specific and must match the Firebase project. Values such as `apiKey`, `authDomain`, `projectId`, `storageBucket` and `appId` are generated for a specific Firebase project and are not available in the browser unless they are written into a frontend file.

The browser cannot read GitHub Actions environment variables directly. A browser is running on the end user's machine, not inside the GitHub runner. So the values must be moved into a generated file that the frontend loads at runtime.

This is why the workflow in [.github/workflows/firebase-config.yml](.github/workflows/firebase-config.yml) writes a file like `firebase-config.js` containing:

```js
window.MIIWISH_FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

Then the page loads that script before the main app logic.

### Why the file is optional in the frontend

The app supports a demo mode for local development and for deployments where Firebase is not configured yet. If the file is missing or the config is incomplete, the app falls back to localStorage demo data instead of crashing.

This is intentional and prevents a 404 from breaking the whole page.

### Required GitHub repository secrets

Set these in the GitHub repository settings under Settings → Secrets and variables → Actions:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

These values come from your Firebase project settings.

### Firebase project setup

Before deployment, make sure the project has:

- Firebase project created
- Web app registered in Firebase
- Authentication enabled for email/password
- Firestore database created
- Firestore security rules configured
- the correct domain allowed for login / storage access

### Deployment flow

1. Add the GitHub secrets.
2. Push to the main branch.
3. GitHub Actions runs the workflow in [.github/workflows/firebase-config.yml](.github/workflows/firebase-config.yml).
4. The workflow writes `firebase-config.js` with the current Firebase values.
5. The static site is deployed and includes that generated file.
6. The browser loads the config and initializes Firebase.
7. If config is absent, the app stays in demo mode and does not fail the page.

### Static hosting setup

This app is designed for static hosting, for example:

- GitHub Pages
- Netlify
- Vercel static hosting
- any static web server

The only important part is that the generated config script is present in the final deployed output at the expected URL.

### Local development

For local testing, you can either:

- generate a temporary `firebase-config.js` manually
- or work in demo mode without Firebase

Example local config:

```js
window.MIIWISH_FIREBASE_CONFIG = {
  apiKey: "demo-key",
  authDomain: "demo-project.firebaseapp.com",
  projectId: "demo-project",
  storageBucket: "demo-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "demo-app-id"
};
```

### Why the browser still needs the config at runtime

The frontend uses Firebase client SDKs in the browser:

- `firebase.auth()` for the admin login
- `firebase.firestore()` for reading and writing wishlist data
- `firebase.initializeApp(config)` to bind the app to the right Firebase project

Without the config, there is no project connection, no authenticated admin session, and no Firestore access. The app falls back to localStorage only when it detects missing config on purpose.

### Session and auth behavior explained

The app manages access in a few layers:

1. A guest enters their name and creates a request.
2. The request is stored in Firestore with a status like `pending`.
3. The admin reviews the request and sets `approved` or `denied`.
4. The user session is kept in the browser via `localStorage` using `wl_myRequestId`.
5. On refresh, the app reads that ID and calls `checkStatus()`.
6. The app then decides whether to show the main wishlist or the waiting/denied gate.

This is important because the browser does not automatically keep a backend session for a static frontend. The app keeps the current request state client-side, while the actual trust is still enforced server-side by Firebase Auth and Firestore rules.

### Security model

The protected part is not the frontend HTML. The actual protection lives in Firebase:

- admin authentication via Firebase Auth
- Firestore rules control who can read or write data
- the public page should never contain hardcoded admin credentials

The frontend only decides which UI to show. The backend rules decide what is actually allowed.

### Common deployment pitfalls

- Missing GitHub secrets
- Config file not included in the deployed output
- Browser is loading `firebase-config.js` from the wrong path
- Firebase Authentication not enabled
- Firestore rules too permissive or too restrictive
- using demo mode accidentally because `projectId` is empty

### Recommended verification checklist

After deployment, confirm:

- the generated config file exists in the deployed site
- the page loads without 404 for `firebase-config.js`
- Firebase initializes without console errors
- admin login works with a real Firebase Auth user
- Firestore reads and writes work according to the rules
- guest request flow still works in the browser

### Final note

The production configuration is not stored in the repository as a real secret. It is injected at build/deploy time from GitHub secrets. That separation is intentional: it keeps secrets out of the source code while still allowing the browser to initialize Firebase for the static site.
