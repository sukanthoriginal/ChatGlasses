sequenceDiagram
    participant User as User
    participant Browser as Desktop Browser
    participant DesktopApp as Desktop App (Port 98)
    participant MobileDevice as Mobile Device
    participant MobileApp as Mobile App (Port 96)
    participant API as AugmentOS API

    Note over User,API: Authentication Flow

    %% Step 1: User visits desktop
    User->>Browser: Visit localhost:98
    Browser->>DesktopApp: GET /
    DesktopApp->>DesktopApp: Generate unique QR code for browser session
    DesktopApp-->>Browser: Return page with QR code
    Browser-->>User: Display QR code

    %% Step 2: User opens mobile app
    User->>MobileDevice: Open mobile app
    MobileDevice->>MobileApp: Access /webview?aos_temp_token=...
    MobileApp->>API: Exchange temp token for user ID
    API-->>MobileApp: Return user ID
    MobileApp-->>MobileDevice: Show camera interface
    MobileDevice-->>User: Camera ready for scanning

    %% Step 3: User scans QR code
    User->>MobileDevice: Scan QR code from desktop
    MobileDevice->>MobileApp: Process scanned QR data
    MobileApp->>MobileApp: Generate secure JWT token (user_id + scanned_url)
    
    %% Step 4: Mobile forwards authentication
    MobileApp->>DesktopApp: POST /api/scan with secure_token
    DesktopApp->>DesktopApp: Verify JWT token & extract user_id
    DesktopApp->>DesktopApp: Link user_id to browser session
    DesktopApp-->>MobileApp: Return success response
    
    %% Step 5: Real-time notification via WebSocket
    DesktopApp->>Browser: WebSocket notification (authentication_successful)
    Browser->>Browser: Auto-redirect to /dashboard
    Browser-->>User: Show authenticated dashboard

    %% Alternative: Manual check (if WebSocket fails)
    alt Manual Check
        Browser->>DesktopApp: GET /check-authenticated
        DesktopApp-->>Browser: Return authenticated=true
        Browser-->>User: Redirect to dashboard
    end
