# Firebase Authentication & Admin Portal Setup Guide

`OSDR_Chatbot` keeps research discovery open to guests on `/` while adding:
- **User Account Portal (`/account` & `/login`)**: Email/Password sign-up, Email/Password sign-in, password reset, email verification, and **Continue with Google** via Firebase Authentication.
- **Dedicated Admin Security Perimeter (`/admin`)**: Separate administrator login gate supporting both:
  1. **Firebase Admin + Custom Claims / Allowlist** (`ADMIN_EMAILS`, `ADMIN_UIDS`, optional `ADMIN_PASSCODE`, optional `FIREBASE_SERVICE_ACCOUNT_JSON`)
  2. **Server-Side Admin Credentials** (`ADMIN_USERNAME` / `ADMIN_EMAILS` + `ADMIN_PASSCODE`) backed by signed `HttpOnly` cookie sessions (`osdr_admin_session`) and brute-force rate limiting.

No Firebase keys or admin secrets are ever hardcoded in client or server source code.

---

## Step 1 — Create or Open Your Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project (or open an existing one).
2. Open **Project settings** (gear icon next to **Project Overview**) -> **General** tab.
3. Under **Your apps**, click the Web icon (`</>`) to register a Web app (for example `OSDR_Chatbot Web`).
4. Copy the `firebaseConfig` fields (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, `measurementId`).

---

## Step 2 — Enable Sign-In Providers & Authorized Domains

1. In the left sidebar of Firebase Console, open **Build -> Authentication -> Get started** (if first time).
2. Open the **Sign-in method** tab and enable:
   - **Email/Password** (click **Enable** -> **Save**)
   - **Google** (click **Enable**, choose a project support email -> **Save**)
3. Open **Authentication -> Settings -> Authorized domains** and verify these hostnames are listed (hostnames only, no `https://` or ports):
   - `localhost` (for local `npm run dev`)
   - `osdr-chatbot-kappa.vercel.app` (or your custom Vercel/production domain)

---

## Step 3 — Configure Local `.env` (and Vercel Environment Variables)

Copy `.env.example` to `.env` in the repository root and fill in the values below:

```dotenv
# Public Firebase Web SDK values (client-safe)
VITE_FIREBASE_API_KEY=your_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX

# Server-Only Admin Access Control (NEVER prefix with VITE_)
ADMIN_EMAILS=you@example.org
ADMIN_USERNAME=osdr-admin
ADMIN_PASSCODE=choose_a_strong_unique_passcode
ADMIN_SESSION_SECRET=choose_a_long_random_32_byte_hex_or_string
```

### Vercel Deployment Notes
Add the exact same variables in **Vercel Dashboard -> Project -> Settings -> Environment Variables**:
- Variables prefixed with `VITE_FIREBASE_*` are read both by the Vite build **and** dynamically via `GET /api/auth/config`, so adding them on Vercel works even if you redeploy cleanly.
- Server-only variables (`ADMIN_EMAILS`, `ADMIN_USERNAME`, `ADMIN_PASSCODE`, `ADMIN_SESSION_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`) stay strictly inside the Node.js serverless function and are **never** exposed to browsers.

---

## Step 4 — Optional: Enable Firebase Admin Custom Claims (`FIREBASE_SERVICE_ACCOUNT_JSON`)

Even without a Service Account JSON, `/api/auth/session` and `/api/admin/verify` cryptographically verify Firebase ID tokens against Google's official `securetoken@system.gserviceaccount.com` X.509 certificates (`RS256`).

If you also want the `/admin` Console to mint custom tokens and grant/revoke persistent Firebase custom claims (`admin: true`) in **Firebase Admin Claims**:
1. In Firebase Console -> **Project settings -> Service accounts**, click **Generate new private key**.
2. Paste the downloaded JSON onto a single line in `.env` as `FIREBASE_SERVICE_ACCOUNT_JSON={...}` (or set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` separately).
3. Never commit service-account JSON files or `.env` (already ignored by `.gitignore`).

---

## Step 5 — Optional: Local Firebase Auth Emulator

To test Email/Password flows offline without hitting live Firebase Auth:
1. Run `firebase emulators:start --only auth` in a separate terminal.
2. Set both of these in `.env`:
   ```dotenv
   VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099
   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
   ```
3. Restart `npm run dev`.

---

## Step 6 — Test `/account` and `/admin`

1. Start the app: `npm run dev` (opens `http://localhost:3000`).
2. Click **Sign In** in the header or sidebar (or visit `/account`) to test **Create Account**, **Email Sign-In**, and **Continue with Google**.
3. Visit `/admin` (or click **Admin** in the header/sidebar) and sign in via **Firebase Admin + Claims** (matching `ADMIN_EMAILS` + `ADMIN_PASSCODE`) or **Server Admin Credentials** (`ADMIN_USERNAME` / `ADMIN_EMAILS` + `ADMIN_PASSCODE`).

