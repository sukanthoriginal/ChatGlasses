"use strict";
// index.ts but for multiple users
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@augmentos/sdk");
const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE;
const API_KEY = process.env.DEV_AUGMENT_API_KEY;
const PORT = 81;
class MyAugmentOSApp extends sdk_1.TpaServer {
    async onSession(session, sessionId, userId) {
        const message = "This is a [DEV] app. Open webview from AugmentOS app and external dashboard at \nqr-dashboard.sukanthoriginal.com";
        console.log(`User ${userId} Session ${sessionId}: ${message}`);
        session.layouts.showTextWall("Listening...");
        // Subscribe to transcription events
        const unsubscribe = session.events.onTranscription((data) => {
            // Handle transcription data
            console.log(`Transcription for user ${userId}: ${data.text}`);
            // Display the transcription text to the user
            session.layouts.showTextWall(data.text);
        });
        // Add cleanup handler for transcription events
        this.addCleanupHandler(unsubscribe);
        await new Promise(resolve => {
            session.events.onDisconnected(() => {
                resolve();
            });
        });
    }
}
const server = new MyAugmentOSApp({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
server.start().catch(err => console.error('Failed to start server:', err));
