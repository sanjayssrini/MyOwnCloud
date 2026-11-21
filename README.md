# MyOwnCloud (LAN MVP)

A single Next.js App Router application that acts as a local-network cloud storage MVP.

## What it does

- Firebase Authentication with Email/Password + Email Verification link.
- Google Sign-In with automatic name extraction.
- User registration with Full Name and custom LAN device naming.
- Lets each user add one or many folders from the host PC.
- Exposes files to other devices on the same WiFi over the LAN IP.
- Tracks online/offline device status with a 5-second heartbeat.
- Stores users, devices, and folder metadata in SQLite.

## Project Structure

```text
app/
  page.js
  dashboard/page.js
  devices/page.js
  api/
    auth/route.js
      folders/route.js
    files/route.js
    download/[name]/route.js
    device/route.js
lib/
  db.js
  config.js
components/
  Navbar.js
  Heartbeat.js
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the dev server so it listens on every LAN interface:

   ```bash
   npm run dev -- -H 0.0.0.0
   ```

3. Find the PC's LAN IP:

   - Open Command Prompt or PowerShell.
   - Run `ipconfig`.
   - Look for the IPv4 address on your active Wi-Fi or Ethernet adapter.

4. Open the app on the host PC:

   - `http://localhost:3000`

5. Open it from another device on the same WiFi:

   - `http://192.168.x.x:3000`
   - Replace `192.168.x.x` with the PC's actual IPv4 address.


## Folder Hosting

- Folders are added from the dashboard with the PC folder picker.
- The app imports the selected folder contents into managed storage.
- You can register multiple folders for the same user.
- The dashboard shows folders first; clicking one opens its files in list or tile view.
- Folders can be removed from the dashboard at any time.
- On Vercel, API routes cannot access folders on your personal PC. Folder hosting works when the app runs on the machine that owns the folders, such as with `npm run dev -- -H 0.0.0.0`.

## Notes

- This is LAN-first cloud storage, streaming files directly across your local network.
- Firebase Authentication manages secure sign-in, email verification, and Google OAuth.
- User profiles and file metadata are saved in SQLite (`better-sqlite3`).
