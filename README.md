# QR Based Authentication for Smart Glasses Application

Login and access the dashboard of your smart glasses apps in external web browsers by scanning the QR from AugmentOS webview.

- **What to scan:** QR code on the browser app dashboard to display user-specific information.
- **Where to get the scan from:** Open webview of your desired app that can scan the QR.
  // Potentially also scan using camera-enabled smart glasses in the future.

---

## Components

### `qr_mobile`  
Server code for app's `/webview` inside AugmentOS with camera for scanning the QR.  
**Interface:** `/webview` inside AugmentOS App

### `qr_web`  
Server code for app's external browser session that requires QR login to access user-specific information.  
**Interface:** Browser sessions in TV or Desktop.

---

## Features

- **QR Code Authentication:** Desktop displays QR codes, mobile scans to authenticate
- **Real-time Communication:** WebSocket integration for instant authentication feedback
- **Token Handling:** JWT-based secure token exchange and validation
- **Session Management:** Thread-safe session handling with automatic cleanup
- **Rate Limiting:** Against excessive API requests
- **Auto-cleanup:** Automatic removal of expired QR codes and sessions


## Sequence Diagram:

![image](https://github.com/user-attachments/assets/7050dc3d-109d-4e78-9a0b-7b48d5bd58f6)


Inviting collaborators to make this more secure!

---
_A Sukanth Original Design & Development
_
