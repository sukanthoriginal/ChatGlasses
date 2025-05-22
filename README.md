# QR Based Authentication for Smart Glasses Application

Access the dashboard of your smart glasses apps in external web browsers by scanning the QR to login. Users scan QR codes with their mobile devices to authenticate desktop sessions.

- **What to scan:** QR code on the browser app dashboard to display user-specific information.
- **Where to get the scan from:** Open webview of your desired app that can scan the QR  
  // Potentially also scan using camera-enabled smart glasses.

---

## Components

### `qr_mobile.py`  
Server code for app's `/webview` inside AugmentOS with camera for scanning the QR.  
**Interface:** `/webview` inside AugmentOS App

### `qr_web.py`  
Server code for app's external browser session that requires QR login to access user-specific information.  
**Interface:** Browser sessions in TV or Desktop.

---

## Features

- **QR Code Authentication:** Desktop displays QR codes, mobile scans to authenticate
- **Real-time Communication:** WebSocket integration for instant authentication feedback
- **Secure Token Handling:** JWT-based secure token exchange and validation
- **Session Management:** Thread-safe session handling with automatic cleanup
- **AugmentOS Integration:** Seamless integration with AugmentOS authentication API
- **Rate Limiting:** Built-in protection against excessive API requests
- **Auto-cleanup:** Automatic removal of expired QR codes and sessions


## Architecture:

<pre> ```plaintext ## Architecture: ┌─────────────────┐ QR Code ┌─────────────────┐ │ Desktop App │ ◄─────────────► │ Mobile App │ │ (Port 98) │ Display │ (Port 96) │ │ │ │ │ │ 1. Shows QR │ │ 3. Scans QR │ │ 2. Waits │◄────────────────│ 4. Posts scan │ │ 5. Redirects │ HTTP POST │ data │ └─────────────────┘ /api/scan └─────────────────┘ ▲ │ │ Token │ Exchange ▼ ┌─────────────────┐ │ AugmentOS API │ │ │ │ • Validates │ │ temp tokens │ │ • Returns │ │ user IDs │ └─────────────────┘ ``` </pre>


