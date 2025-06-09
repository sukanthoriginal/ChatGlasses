// index.ts but for multiple users

import { TpaServer, TpaSession } from '@augmentos/sdk';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE as string;
const API_KEY = process.env.DEV_AUGMENT_API_KEY as string;
const PORT = 81;


class MyAugmentOSApp extends TpaServer {
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
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

    await new Promise<void>(resolve => {
      session.events.onDisconnected(() => {
        resolve();
      });
    });
  }
}


const server = new MyAugmentOSApp({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
server.start().catch(err => console.error('Failed to start server:', err));