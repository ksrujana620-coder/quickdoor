# Quick door — Netlify Fix

## The Problem
Netlify is **static hosting only** — it cannot run your Node.js `server.js`.  
Your `/api/*` calls were hitting nothing, causing "Name, phone, and password are required" errors.

## The Fix: Netlify Serverless Function
Your entire backend is now a single file: `functions/api.js`  
It wraps Express using `serverless-http` so all `/api/*` routes work on Netlify.

---

## ✅ Your New Folder Structure

```
your-project/
├── netlify.toml          ← REPLACE your existing one
├── package.json          ← REPLACE your existing root one
├── functions/
│   └── api.js            ← NEW FILE (your entire backend)
└── frontend/
    ├── home.html
    ├── login.html
    ├── signup.html
    ├── admin.html
    ├── admin-auth.html
    ├── shop-owner.html
    ├── deliveryboy.html
    ├── product.html
    ├── payment.html
    ├── profile.html
    ├── orderconfirmation.html
    ├── index.html
    ├── css/
    │   └── style.css
    ├── js/
    │   └── app.js
    └── images/
        └── qvs.jpeg
```

> ⚠️ Put ALL your .html files inside the `frontend/` folder.

---

## 🚀 Steps to Deploy

### 1. Set Environment Variables on Netlify
Go to: **Netlify Dashboard → Site → Environment Variables**

Add these (required for SMS, optional but recommended):
```
TWILIO_ACCOUNT_SID     = your_actual_sid
TWILIO_AUTH_TOKEN      = your_actual_token
TWILIO_PHONE_NUMBER    = +1234567890
```

Firebase is already hardcoded in `functions/api.js` from your `firebase.js`.  
If you want to move them to env vars, also add:
```
FIREBASE_API_KEY            = AIzaSyB6yedH7WPFidqfifEQjKvOss-rzpqv__A
FIREBASE_AUTH_DOMAIN        = quickvillageservice.firebaseapp.com
FIREBASE_PROJECT_ID         = quickvillageservice
FIREBASE_STORAGE_BUCKET     = quickvillageservice.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID= 453085397164
FIREBASE_APP_ID             = 1:453085397164:web:76c3e89cfdfeb4edbb1f09
```

### 2. Push to GitHub and Netlify auto-deploys.

### 3. Check Function Logs
Netlify Dashboard → Functions → api → Logs  
OTPs will appear here if Twilio isn't configured.

---

## ⚠️ Firebase Rules
Make sure your Firestore rules allow read/write (for now, while testing):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```
Set this in Firebase Console → Firestore → Rules.

---

## Why SQLite was removed
Netlify's filesystem is **read-only** in Functions — SQLite cannot write files.  
Your project already had Firebase set up (`firebase.js`), so all data now goes to Firestore.
