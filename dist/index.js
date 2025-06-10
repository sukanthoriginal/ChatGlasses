"use strict";
// index.ts but for multiple users
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@augmentos/sdk");
const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE;
const API_KEY = process.env.DEV_AUGMENT_API_KEY;
const PORT = 81;
// Store active sessions
const activeSessions = new Map();
class MyAugmentOSApp extends sdk_1.TpaServer {
    async onSession(session, sessionId, userId) {
        console.log(`User ${userId} connected with session ${sessionId}`);
        // Store the session
        activeSessions.set(userId, session);
        // Show initial message
        const connectedUsers = activeSessions.size;
        const message = connectedUsers === 1
            ? "Waiting for another user to connect..."
            : "Connected! You can now speak and see each other's transcriptions.";
        session.layouts.showTextWall(message);
        // Subscribe to transcription events
        const unsubscribe = session.events.onTranscription((data) => {
            // Handle transcription data
            console.log(`Transcription from user ${userId}: ${data.text}`);
            // Send transcription to all other users
            activeSessions.forEach((otherSession, otherUserId) => {
                if (otherUserId !== userId) {
                    otherSession.layouts.showTextWall(`User ${userId}: ${data.text}`);
                }
            });
        });
        // Add cleanup handler for transcription events
        this.addCleanupHandler(unsubscribe);
        // Handle disconnection
        await new Promise(resolve => {
            session.events.onDisconnected(() => {
                console.log(`User ${userId} disconnected`);
                activeSessions.delete(userId);
                // Notify remaining users
                activeSessions.forEach((otherSession) => {
                    otherSession.layouts.showTextWall("Other user disconnected. Waiting for new connection...");
                });
                resolve();
            });
        });
    }
}
const server = new MyAugmentOSApp({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
server.start().catch(err => console.error('Failed to start server:', err));
