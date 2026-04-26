# MyOwnCloud (LAN MVP)

A single Next.js App Router application that acts as a local-network cloud storage MVP.

## What it does

- OTP login flow using email + one-time code.
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

- Folders are user-managed and entered from the dashboard as absolute local paths.
- The app does not auto-create folders.
- You can register multiple folders for the same user.
- The files view aggregates files from all available registered folders.

## Notes

- This is LAN-only MVP storage, not public cloud storage.
- OTP is returned in API response for local MVP testing because no email provider is configured.
- No external database or backend server is required.
