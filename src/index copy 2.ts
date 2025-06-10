import { TpaServer, TpaSession } from '@augmentos/sdk';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE as string;
const API_KEY = process.env.DEV_AUGMENT_API_KEY as string;
const PORT = 81;

// User database with nicknames
const userDatabase = new Map<string, string>([
  ['ontelligency@gmail.com', 'John.'],
  ['optimistic.sukanth@gmail.com', 'Girish.']
]);

// Reverse lookup for email by nickname
const nicknameToEmail = new Map<string, string>();
userDatabase.forEach((nickname, email) => {
  nicknameToEmail.set(nickname, email);
});

// Store active sessions
const activeSessions = new Map<string, TpaSession>();

// Store chat states
interface ChatRequest {
  fromUserId: string;
  toUserId: string;
  fromNickname: string;
  timestamp: number;
}

const pendingChatRequests = new Map<string, ChatRequest>();
const activeChatSessions = new Map<string, string>(); // userId -> partnerId

class MyAugmentOSApp extends TpaServer {
  protected async onSession(session: TpaSession, sessionId: string, userId: string): Promise<void> {
    console.log(`User ${userId} connected with session ${sessionId}`);
    
    // Store the session
    activeSessions.set(userId, session);
    
    const userNickname = userDatabase.get(userId) || userId;
    
    // Show initial message with available users
    this.showMainMenu(session, userId);

    // Subscribe to transcription events for chat commands
    const unsubscribe = session.events.onTranscription((data) => {
      const text = data.text.toLowerCase().trim();
      console.log(`Command from user ${userId} (${userNickname}): ${data.text}`);
      
      // Handle chat commands
      if (text.startsWith('chat ')) {
        const targetNickname = data.text.substring(5).trim();
        this.handleChatRequest(userId, targetNickname);
      } else if (text === 'accept' || text === 'accept chat') {
        this.handleChatAccept(userId);
      } else if (text === 'reject' || text === 'reject chat') {
        this.handleChatReject(userId);
      } else if (text === 'end chat' || text === 'exit chat') {
        this.handleEndChat(userId);
      } else if (text === 'menu' || text === 'main menu') {
        this.showMainMenu(session, userId);
      } else {
        // If in active chat, send message to chat partner
        const partnerId = activeChatSessions.get(userId);
        if (partnerId && activeSessions.has(partnerId)) {
          const partnerSession = activeSessions.get(partnerId)!;
          partnerSession.layouts.showTextWall(`${userNickname}: ${data.text}`);
        }
      }
    });

    // Add cleanup handler for transcription events
    this.addCleanupHandler(unsubscribe);

    // Handle disconnection
    await new Promise<void>(resolve => {
      session.events.onDisconnected(() => {
        console.log(`User ${userId} (${userNickname}) disconnected`);
        this.handleUserDisconnect(userId);
        resolve();
      });
    });
  }

  private showMainMenu(session: TpaSession, userId: string): void {
    const userNickname = userDatabase.get(userId) || userId;
    const availableUsers: string[] = [];
    
    activeSessions.forEach((_, otherUserId) => {
      if (otherUserId !== userId) {
        const otherNickname = userDatabase.get(otherUserId) || otherUserId;
        availableUsers.push(otherNickname);
      }
    });

    let message = `Welcome ${userNickname}!\n\n`;
    
    if (availableUsers.length === 0) {
      message += "No other users online. Waiting for connections...";
    } else {
      message += `Available users: ${availableUsers.join(', ')}\n\n`;
      message += "Commands:\n";
      message += "• Say 'Chat [nickname]' to start a chat\n";
      message += "• Say 'Accept' to accept incoming chat requests\n";
      message += "• Say 'Reject' to reject incoming chat requests\n";
      message += "• Say 'End chat' to end current chat\n";
      message += "• Say 'Menu' to show this menu";
    }

    session.layouts.showTextWall(message);
  }

  private handleChatRequest(fromUserId: string, targetNickname: string): void {
    const fromNickname = userDatabase.get(fromUserId) || fromUserId;
    const targetEmail = nicknameToEmail.get(targetNickname);
    
    if (!targetEmail) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        session.layouts.showTextWall(`User "${targetNickname}" not found. Available users: ${this.getAvailableNicknames(fromUserId).join(', ')}`);
      }
      return;
    }

    if (!activeSessions.has(targetEmail)) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        session.layouts.showTextWall(`${targetNickname} is not online.`);
      }
      return;
    }

    if (fromUserId === targetEmail) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        session.layouts.showTextWall("You cannot chat with yourself!");
      }
      return;
    }

    // Check if either user is already in a chat
    if (activeChatSessions.has(fromUserId) || activeChatSessions.has(targetEmail)) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        session.layouts.showTextWall("One of you is already in a chat. Please end current chat first.");
      }
      return;
    }

    // Store the chat request
    const chatRequest: ChatRequest = {
      fromUserId,
      toUserId: targetEmail,
      fromNickname,
      timestamp: Date.now()
    };

    pendingChatRequests.set(targetEmail, chatRequest);

    // Notify both users
    const fromSession = activeSessions.get(fromUserId);
    const toSession = activeSessions.get(targetEmail);

    if (fromSession) {
      fromSession.layouts.showTextWall(`Chat request sent to ${targetNickname}. Waiting for response...`);
    }

    if (toSession) {
      toSession.layouts.showTextWall(`Chat request from ${fromNickname}!\nSay "Accept" to accept or "Reject" to decline.`);
    }
  }

  private handleChatAccept(userId: string): void {
    const chatRequest = pendingChatRequests.get(userId);
    if (!chatRequest) {
      const session = activeSessions.get(userId);
      if (session) {
        session.layouts.showTextWall("No pending chat requests.");
      }
      return;
    }

    // Remove the pending request
    pendingChatRequests.delete(userId);

    // Start the chat session
    activeChatSessions.set(chatRequest.fromUserId, userId);
    activeChatSessions.set(userId, chatRequest.fromUserId);

    const userNickname = userDatabase.get(userId) || userId;
    const fromSession = activeSessions.get(chatRequest.fromUserId);
    const toSession = activeSessions.get(userId);

    if (fromSession) {
      fromSession.layouts.showTextWall(`${userNickname} accepted your chat request! You can now talk. Say "End chat" to exit.`);
    }

    if (toSession) {
      toSession.layouts.showTextWall(`Chat started with ${chatRequest.fromNickname}! You can now talk. Say "End chat" to exit.`);
    }
  }

  private handleChatReject(userId: string): void {
    const chatRequest = pendingChatRequests.get(userId);
    if (!chatRequest) {
      const session = activeSessions.get(userId);
      if (session) {
        session.layouts.showTextWall("No pending chat requests.");
      }
      return;
    }

    // Remove the pending request
    pendingChatRequests.delete(userId);

    const userNickname = userDatabase.get(userId) || userId;
    const fromSession = activeSessions.get(chatRequest.fromUserId);
    const toSession = activeSessions.get(userId);

    if (fromSession) {
      fromSession.layouts.showTextWall(`${userNickname} declined your chat request.`);
      this.showMainMenu(fromSession, chatRequest.fromUserId);
    }

    if (toSession) {
      toSession.layouts.showTextWall(`Chat request from ${chatRequest.fromNickname} declined.`);
      this.showMainMenu(toSession, userId);
    }
  }

  private handleEndChat(userId: string): void {
    const partnerId = activeChatSessions.get(userId);
    if (!partnerId) {
      const session = activeSessions.get(userId);
      if (session) {
        session.layouts.showTextWall("You are not in an active chat.");
      }
      return;
    }

    // End the chat for both users
    activeChatSessions.delete(userId);
    activeChatSessions.delete(partnerId);

    const userNickname = userDatabase.get(userId) || userId;
    const partnerNickname = userDatabase.get(partnerId) || partnerId;

    const userSession = activeSessions.get(userId);
    const partnerSession = activeSessions.get(partnerId);

    if (userSession) {
      userSession.layouts.showTextWall(`Chat with ${partnerNickname} ended.`);
      this.showMainMenu(userSession, userId);
    }

    if (partnerSession) {
      partnerSession.layouts.showTextWall(`${userNickname} ended the chat.`);
      this.showMainMenu(partnerSession, partnerId);
    }
  }

  private handleUserDisconnect(userId: string): void {
    const userNickname = userDatabase.get(userId) || userId;
    
    // Remove from active sessions
    activeSessions.delete(userId);

    // Handle if user was in a chat
    const partnerId = activeChatSessions.get(userId);
    if (partnerId) {
      activeChatSessions.delete(userId);
      activeChatSessions.delete(partnerId);
      
      const partnerSession = activeSessions.get(partnerId);
      if (partnerSession) {
        partnerSession.layouts.showTextWall(`${userNickname} disconnected. Chat ended.`);
        this.showMainMenu(partnerSession, partnerId);
      }
    }

    // Handle if user had pending chat requests
    const chatRequest = pendingChatRequests.get(userId);
    if (chatRequest) {
      pendingChatRequests.delete(userId);
      const fromSession = activeSessions.get(chatRequest.fromUserId);
      if (fromSession) {
        fromSession.layouts.showTextWall(`${userNickname} disconnected. Chat request cancelled.`);
        this.showMainMenu(fromSession, chatRequest.fromUserId);
      }
    }

    // Remove any outgoing chat requests from this user
    pendingChatRequests.forEach((request, targetUserId) => {
      if (request.fromUserId === userId) {
        pendingChatRequests.delete(targetUserId);
        const targetSession = activeSessions.get(targetUserId);
        if (targetSession) {
          targetSession.layouts.showTextWall(`${userNickname} disconnected. Chat request cancelled.`);
          this.showMainMenu(targetSession, targetUserId);
        }
      }
    });

    // Notify remaining users about disconnection
    activeSessions.forEach((session, remainingUserId) => {
      this.showMainMenu(session, remainingUserId);
    });
  }

  private getAvailableNicknames(excludeUserId: string): string[] {
    const available: string[] = [];
    activeSessions.forEach((_, userId) => {
      if (userId !== excludeUserId) {
        const nickname = userDatabase.get(userId) || userId;
        available.push(nickname);
      }
    });
    return available;
  }
}

const server = new MyAugmentOSApp({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
server.start().catch(err => console.error('Failed to start server:', err));