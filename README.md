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

flowchart LR
    A[Desktop App<br>(Port 98)] 
    B[Mobile App<br>(Port 96)]
    C[AugmentOS API]

    A <-->|QR Code Display| B
    A <-->|HTTP POST /api/scan| B

    B -->|Token Exchange| C
    A -->|Token Exchange| C

    subgraph DesktopApp ["Desktop App"]
      direction TB
      A1["1. Shows QR"]
      A2["2. Waits"]
      A3["5. Redirects"]
      A1 --> A2 --> A3
    end

    subgraph MobileApp ["Mobile App"]
      direction TB
      B1["3. Scans QR"]
      B2["4. Posts scan data"]
      B1 --> B2
    end

    subgraph API ["AugmentOS API"]
      direction TB
      C1["• Validates temp tokens"]
      C2["• Returns user IDs"]
      C1 --> C2
    end

    %% Cross-subgraph interactions
    A1 -.-> B1
    B2 --> C1
    A2 -.-> C2

