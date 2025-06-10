// index.ts but for multiple users

import { TpaServer, TpaSession } from '@augmentos/sdk';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE as string;
const API_KEY = process.env.DEV_AUGMENT_API_KEY as string;
const PORT = 81;

// Store active sessions
const activeSessions = new Map<string, TpaSession>();

class MyAugmentOSApp extends TpaServer {
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
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
    await new Promise<void>(resolve => {
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