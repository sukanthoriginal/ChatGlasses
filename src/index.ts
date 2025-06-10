import { TpaServer, TpaSession } from '@augmentos/sdk';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE as string;
const API_KEY = process.env.DEV_AUGMENT_API_KEY as string;
const PORT = 81;

// Dynamic data structure - fetched from Python backend
let personalNicknames = new Map<string, Map<string, string>>();

// Function to fetch contacts from Python backend
async function fetchContactsFromDB(): Promise<void> {
  try {
    const { spawn } = require('child_process');
    const python = spawn('python', ['src/contacts_db.py']);
    
    let dataString = '';
    
    python.stdout.on('data', (data: Buffer) => {
      dataString += data.toString();
    });
    
    python.stderr.on('data', (data: Buffer) => {
      console.error(`Python error: ${data}`);
    });
    
    python.on('close', (code: number) => {
      if (code === 0) {
        try {
          // Parse the TypeScript output and extract the data
          const lines = dataString.trim().split('\n');
          const newPersonalNicknames = new Map<string, Map<string, string>>();
          
          let currentUserId = '';
          let inUserSection = false;
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            // Match user ID line: ['user@example.com', new Map([
            const userMatch = trimmedLine.match(/^\['([^']+)',\s*new Map\(\[$/);
            if (userMatch) {
              currentUserId = userMatch[1];
              newPersonalNicknames.set(currentUserId, new Map<string, string>());
              inUserSection = true;
              continue;
            }
            
            // Match contact line: ['contact@example.com', "Nickname"],
            const contactMatch = trimmedLine.match(/^\['([^']+)',\s*"([^"]+)"\],?$/);
            if (contactMatch && currentUserId) {
              const contactEmail = contactMatch[1];
              const nickname = contactMatch[2];
              newPersonalNicknames.get(currentUserId)?.set(contactEmail, nickname);
              continue;
            }
            
            // End of user section
            if (trimmedLine === '])],') {
              inUserSection = false;
              currentUserId = '';
            }
          }
          
          personalNicknames = newPersonalNicknames;
          console.log('✅ Contacts updated from database');
        } catch (parseError) {
          console.error('❌ Failed to parse contacts data:', parseError);
        }
      } else {
        console.error(`❌ Python script exited with code ${code}`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to fetch contacts:', error);
  }
}

// Initial fetch and periodic refresh
fetchContactsFromDB();
setInterval(fetchContactsFromDB, 30000); // Refresh every 30 seconds

// Helper functions (unchanged)
const getFriends = (userId: string): string[] => {
  const userNicknames = personalNicknames.get(userId);
  return userNicknames ? Array.from(userNicknames.keys()) : [];
};

const areMutualFriends = (userId1: string, userId2: string): boolean => {
  const user1Nicknames = personalNicknames.get(userId1);
  const user2Nicknames = personalNicknames.get(userId2);
  
  return !!(user1Nicknames?.has(userId2) && user2Nicknames?.has(userId1));
};

const getUserEmailByNickname = (userId: string, nickname: string): string | undefined => {
  const userNicknames = personalNicknames.get(userId);
  if (!userNicknames) return undefined;
  
  for (const [email, nick] of userNicknames.entries()) {
    if (nick.toLowerCase() === nickname.toLowerCase()) {
      return email;
    }
  }
  return undefined;
};

const getNicknameForUser = (userId: string, targetUserId: string): string => {
  const userNicknames = personalNicknames.get(userId);
  return userNicknames?.get(targetUserId) || targetUserId;
};

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
    
    // Show initial message with user's friends
    this.showMainMenu(session, userId);

    // Subscribe to transcription events for chat commands
    const unsubscribe = session.events.onTranscription((data) => {
      const text = data.text.toLowerCase().trim();
      console.log(`Command from user ${userId}: ${data.text}`);
      
      // Handle chat commands
      if (text.startsWith('chat ')) {
        const targetNickname = this.cleanInput(data.text.substring(5).trim());
        this.handleChatRequest(userId, targetNickname);
      } else if (text === 'accept' || text === 'accept chat') {
        this.handleChatAccept(userId);
      } else if (text === 'reject' || text === 'reject chat') {
        this.handleChatReject(userId);
      } else if (text === 'end chat' || text === 'exit chat') {
        this.handleEndChat(userId);
      } else if (text === 'menu' || text === 'main menu') {
        this.showMainMenu(session, userId);
      } else if (text === 'friends' || text === 'friend list') {
        this.showFriendsList(session, userId);
      } else if (text === 'refresh contacts' || text === 'update contacts') {
        // Manual refresh command
        fetchContactsFromDB();
        session.layouts.showTextWall("Refreshing contacts from database...");
      } else {
        // If in active chat, send message to chat partner
        const partnerId = activeChatSessions.get(userId);
        if (partnerId && activeSessions.has(partnerId)) {
          const partnerSession = activeSessions.get(partnerId)!;
          const senderNickname = getNicknameForUser(partnerId, userId);
          partnerSession.layouts.showTextWall(`${senderNickname}: ${data.text}`);
        }
      }
    });

    this.addCleanupHandler(unsubscribe);

    await new Promise<void>(resolve => {
      session.events.onDisconnected(() => {
        console.log(`User ${userId} disconnected`);
        this.handleUserDisconnect(userId);
        resolve();
      });
    });
  }

  private cleanInput(text: string): string {
    return text.replace(/[.,!?;:]$/, '').trim();
  }

  private showMainMenu(session: TpaSession, userId: string): void {
    const onlineFriends = this.getOnlineFriends(userId);

    let message = `Welcome!\n\n`;
    
    message += "ChatGlasses!\n";
    
    message += "• Say 'Chat [friend name]' to start a new chat\n";

    session.layouts.showTextWall(message);
    
    setTimeout(() => {
      session.layouts.showTextWall(" ");
    }, 5000);
  }

  private showFriendsList(session: TpaSession, userId: string): void {
    const userFriends = getFriends(userId);
    const onlineFriends = this.getOnlineFriends(userId);
    
    let message = `Your Friends:\n\n`;
    
    if (userFriends.length === 0) {
      message += "You have no friends in your list.";
    } else {
      userFriends.forEach(friendEmail => {
        const friendNickname = getNicknameForUser(userId, friendEmail);
        const isOnline = onlineFriends.includes(friendEmail);
        const status = isOnline ? "🟢 Online" : "⚫ Offline";
        message += `• ${friendNickname} - ${status}\n`;
      });
      
      message += `\nSay 'Chat [friend name]' to start chatting with an online friend.`;
    }

    session.layouts.showTextWall(message);
  }

  private getOnlineFriends(userId: string): string[] {
    const userFriends = getFriends(userId);
    const onlineFriends: string[] = [];
    
    userFriends.forEach(friendEmail => {
      if (activeSessions.has(friendEmail)) {
        onlineFriends.push(friendEmail);
      }
    });
    
    return onlineFriends;
  }

  private getOnlineFriendNicknames(userId: string): string[] {
    const onlineFriendEmails = this.getOnlineFriends(userId);
    return onlineFriendEmails.map(email => getNicknameForUser(userId, email));
  }

  private handleChatRequest(fromUserId: string, targetNickname: string): void {
    const userFriends = getFriends(fromUserId);
    
    const targetEmail = getUserEmailByNickname(fromUserId, targetNickname);
    
    if (!targetEmail) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        const availableFriends = this.getOnlineFriendNicknames(fromUserId);
        session.layouts.showTextWall(`"${targetNickname}" not found in your contacts. Available friends: ${availableFriends.join(', ')}`);
      }
      return;
    }

    if (!userFriends.includes(targetEmail)) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        const availableFriends = this.getOnlineFriendNicknames(fromUserId);
        session.layouts.showTextWall(`"${targetNickname}" is not in your friend list. Available friends: ${availableFriends.join(', ')}`);
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

    if (!areMutualFriends(fromUserId, targetEmail)) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        session.layouts.showTextWall(`You can only chat with mutual friends. ${targetNickname} doesn't have you in their friend list.`);
      }
      return;
    }

    if (activeChatSessions.has(fromUserId) || activeChatSessions.has(targetEmail)) {
      const session = activeSessions.get(fromUserId);
      if (session) {
        session.layouts.showTextWall("One of you is already in a chat. Please end current chat first.");
      }
      return;
    }

    const chatRequest: ChatRequest = {
      fromUserId,
      toUserId: targetEmail,
      fromNickname: getNicknameForUser(targetEmail, fromUserId),
      timestamp: Date.now()
    };

    pendingChatRequests.set(targetEmail, chatRequest);

    const fromSession = activeSessions.get(fromUserId);
    const toSession = activeSessions.get(targetEmail);

    if (fromSession) {
      let countdown = 30;
      const updateFrom = () => {
        if (!pendingChatRequests.has(targetEmail)) {
          return;
        }
        fromSession.layouts.showTextWall(`Chat request sent to ${targetNickname}. Waiting for response... (${countdown}s)`);
        countdown--;
        if (countdown >= 0) {
          setTimeout(updateFrom, 1000);
        } else {
          this.showMainMenu(fromSession, fromUserId);
        }
      };
      updateFrom();
    }

    if (toSession) {
      let countdown = 30;
      const updateTo = () => {
        if (!pendingChatRequests.has(targetEmail)) {
          return;
        }
        toSession.layouts.showTextWall(`Chat request from ${chatRequest.fromNickname}!\nSay "Accept" to accept or "Reject" to decline. (${countdown}s)`);
        countdown--;
        if (countdown >= 0) {
          setTimeout(updateTo, 1000);
        } else {
          this.showMainMenu(toSession, targetEmail);
        }
      };
      updateTo();
    }
  }

  private handleChatAccept(userId: string): void {
    const chatRequest = pendingChatRequests.get(userId);
    if (!chatRequest) {
      const session = activeSessions.get(userId);
      if (session) {
        this.showTemporaryMessage(session, "No pending chat requests.");
      }
      return;
    }

    pendingChatRequests.delete(userId);

    activeChatSessions.set(chatRequest.fromUserId, userId);
    activeChatSessions.set(userId, chatRequest.fromUserId);

    const userNickname = getNicknameForUser(chatRequest.fromUserId, userId);
    const fromSession = activeSessions.get(chatRequest.fromUserId);
    const toSession = activeSessions.get(userId);

    if (fromSession) {
      fromSession.layouts.showTextWall(" ");
    }
    if (toSession) {
      toSession.layouts.showTextWall(" ");
    }

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
        this.showTemporaryMessage(session, "No pending chat requests.");
      }
      return;
    }

    pendingChatRequests.delete(userId);

    const userNickname = getNicknameForUser(chatRequest.fromUserId, userId);
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

  private showTemporaryMessage(session: TpaSession, message: string, duration: number = 5000): void {
    session.layouts.showTextWall(message);
    setTimeout(() => {
      session.layouts.showTextWall("");
    }, duration);
  }

  private handleEndChat(userId: string): void {
    const partnerId = activeChatSessions.get(userId);
    if (!partnerId) {
      const session = activeSessions.get(userId);
      if (session) {
        this.showTemporaryMessage(session, "You are not in an active chat.");
      }
      return;
    }

    activeChatSessions.delete(userId);
    activeChatSessions.delete(partnerId);

    const userNickname = getNicknameForUser(partnerId, userId);
    const partnerNickname = getNicknameForUser(userId, partnerId);

    const userSession = activeSessions.get(userId);
    const partnerSession = activeSessions.get(partnerId);

    if (userSession) {
      this.showTemporaryMessage(userSession, `Chat with ${partnerNickname} ended.`);
      this.showMainMenu(userSession, userId);
    }

    if (partnerSession) {
      this.showTemporaryMessage(partnerSession, `${userNickname} ended the chat.`);
      this.showMainMenu(partnerSession, partnerId);
    }
  }

  private handleUserDisconnect(userId: string): void {
    activeSessions.delete(userId);

    const partnerId = activeChatSessions.get(userId);
    if (partnerId) {
      activeChatSessions.delete(userId);
      activeChatSessions.delete(partnerId);
      
      const partnerSession = activeSessions.get(partnerId);
      if (partnerSession) {
        const disconnectedUserNickname = getNicknameForUser(partnerId, userId);
        partnerSession.layouts.showTextWall(`${disconnectedUserNickname} disconnected. Chat ended.`);
        this.showMainMenu(partnerSession, partnerId);
      }
    }

    const chatRequest = pendingChatRequests.get(userId);
    if (chatRequest) {
      pendingChatRequests.delete(userId);
      const fromSession = activeSessions.get(chatRequest.fromUserId);
      if (fromSession) {
        const disconnectedUserNickname = getNicknameForUser(chatRequest.fromUserId, userId);
        fromSession.layouts.showTextWall(`${disconnectedUserNickname} disconnected. Chat request cancelled.`);
        this.showMainMenu(fromSession, chatRequest.fromUserId);
      }
    }

    pendingChatRequests.forEach((request, targetUserId) => {
      if (request.fromUserId === userId) {
        pendingChatRequests.delete(targetUserId);
        const targetSession = activeSessions.get(targetUserId);
        if (targetSession) {
          const disconnectedUserNickname = getNicknameForUser(targetUserId, userId);
          targetSession.layouts.showTextWall(`${disconnectedUserNickname} disconnected. Chat request cancelled.`);
          this.showMainMenu(targetSession, targetUserId);
        }
      }
    });

    activeSessions.forEach((session, remainingUserId) => {
      const remainingUserFriends = getFriends(remainingUserId);
      if (remainingUserFriends.includes(userId)) {
        this.showMainMenu(session, remainingUserId);
      }
    });
  }
}

const server = new MyAugmentOSApp({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
server.start().catch(err => console.error('Failed to start server:', err));