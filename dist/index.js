"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@augmentos/sdk");
const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE;
const API_KEY = process.env.DEV_AUGMENT_API_KEY;
const PORT = 81;
// Dynamic data structure - fetched from Python backend
let personalNicknames = new Map();
// Function to fetch contacts from Python backend
async function fetchContactsFromDB() {
    try {
        const { spawn } = require('child_process');
        const python = spawn('python', ['src/contacts_db.py']);
        let dataString = '';
        python.stdout.on('data', (data) => {
            dataString += data.toString();
        });
        python.stderr.on('data', (data) => {
            console.error(`Python error: ${data}`);
        });
        python.on('close', (code) => {
            if (code === 0) {
                try {
                    // Parse the TypeScript output and extract the data
                    const lines = dataString.trim().split('\n');
                    const newPersonalNicknames = new Map();
                    let currentUserId = '';
                    let inUserSection = false;
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        // Match user ID line: ['user@example.com', new Map([
                        const userMatch = trimmedLine.match(/^\['([^']+)',\s*new Map\(\[$/);
                        if (userMatch) {
                            currentUserId = userMatch[1];
                            newPersonalNicknames.set(currentUserId, new Map());
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
                }
                catch (parseError) {
                    console.error('❌ Failed to parse contacts data:', parseError);
                }
            }
            else {
                console.error(`❌ Python script exited with code ${code}`);
            }
        });
    }
    catch (error) {
        console.error('❌ Failed to fetch contacts:', error);
    }
}
// Initial fetch and periodic refresh
fetchContactsFromDB();
setInterval(fetchContactsFromDB, 30000); // Refresh every 30 seconds
// Helper functions (unchanged)
const getFriends = (userId) => {
    const userNicknames = personalNicknames.get(userId);
    return userNicknames ? Array.from(userNicknames.keys()) : [];
};
const areMutualFriends = (userId1, userId2) => {
    const user1Nicknames = personalNicknames.get(userId1);
    const user2Nicknames = personalNicknames.get(userId2);
    return !!(user1Nicknames?.has(userId2) && user2Nicknames?.has(userId1));
};
const getUserEmailByNickname = (userId, nickname) => {
    const userNicknames = personalNicknames.get(userId);
    if (!userNicknames)
        return undefined;
    for (const [email, nick] of userNicknames.entries()) {
        if (nick.toLowerCase() === nickname.toLowerCase()) {
            return email;
        }
    }
    return undefined;
};
const getNicknameForUser = (userId, targetUserId) => {
    const userNicknames = personalNicknames.get(userId);
    return userNicknames?.get(targetUserId) || targetUserId;
};
// Store active sessions
const activeSessions = new Map();
const pendingChatRequests = new Map();
const activeChatSessions = new Map(); // userId -> partnerId
class MyAugmentOSApp extends sdk_1.TpaServer {
    constructor() {
        super(...arguments);
        // Message storage properties
        this.conversationBuffers = new Map();
        this.messageTimers = new Map();
    }
    async onSession(session, sessionId, userId) {
        console.log(`User ${userId} connected with session ${sessionId}`);
        // Store the session
        activeSessions.set(userId, session);
        // Show initial message with user's friends
        this.showMainMenu(session, userId);
        // Subscribe to transcription events for chat commands
        const unsubscribe = session.events.onTranscription(async (data) => {
            const text = data.text.toLowerCase().trim();
            console.log(`Command from user ${userId}: ${data.text}`);
            // Handle chat commands
            if (text.startsWith('chat ')) {
                const targetNickname = this.cleanInput(data.text.substring(5).trim());
                this.handleChatRequest(userId, targetNickname);
            }
            else if (text === 'accept' || text === 'accept chat') {
                this.handleChatAccept(userId);
            }
            else if (text === 'reject' || text === 'reject chat') {
                this.handleChatReject(userId);
            }
            else if (text === 'end chat' || text === 'exit chat') {
                this.handleEndChat(userId);
            }
            else if (text === 'menu' || text === 'main menu') {
                this.showMainMenu(session, userId);
            }
            else if (text === 'friends' || text === 'friend list') {
                this.showFriendsList(session, userId);
            }
            else if (text === 'refresh contacts' || text === 'update contacts') {
                // Manual refresh command
                fetchContactsFromDB();
                session.layouts.showTextWall("Refreshing contacts from database...");
            }
            else {
                // If in active chat, handle the message
                await this.handleChatMessage(userId, data.text);
            }
        });
        this.addCleanupHandler(unsubscribe);
        await new Promise(resolve => {
            session.events.onDisconnected(() => {
                console.log(`User ${userId} disconnected`);
                this.handleUserDisconnect(userId);
                resolve();
            });
        });
    }
    async saveCompletedMessage(chatId, userId, message) {
        try {
            const { spawn } = require('child_process');
            const python = spawn('python', ['src/save_message.py', chatId, userId, message]);
            python.stderr.on('data', (data) => {
                console.error(`Save message error: ${data}`);
            });
            python.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Message saved for chat ${chatId}`);
                }
                else {
                    console.error(`❌ Failed to save message, exit code: ${code}`);
                }
            });
        }
        catch (error) {
            console.error('❌ Failed to spawn save message process:', error);
        }
    }
    async handleChatMessage(userId, text) {
        const partnerId = activeChatSessions.get(userId);
        if (!partnerId || !activeSessions.has(partnerId))
            return;
        // Get or create buffer for this user
        const buffer = this.conversationBuffers.get(userId) || {
            userId,
            partnerId,
            buffer: '',
            lastUpdate: Date.now()
        };
        // Add text to buffer
        buffer.buffer += text + ' ';
        buffer.lastUpdate = Date.now();
        // Check for natural completion (ends with punctuation)
        const isComplete = /[.!?]\s*$/.test(text.trim());
        if (isComplete) {
            // Natural completion - save immediately
            const chatId = [userId, partnerId].sort().join('_');
            await this.saveCompletedMessage(chatId, userId, buffer.buffer.trim());
            buffer.buffer = ''; // Clear buffer
        }
        else {
            // No natural completion - set timeout for artificial completion
            const existingTimer = this.messageTimers.get(userId);
            if (existingTimer)
                clearTimeout(existingTimer);
            const timer = setTimeout(async () => {
                if (buffer.buffer.trim()) {
                    const chatId = [userId, partnerId].sort().join('_');
                    await this.saveCompletedMessage(chatId, userId, buffer.buffer.trim());
                    buffer.buffer = ''; // Clear buffer
                    this.conversationBuffers.set(userId, buffer);
                }
            }, 3000); // 3 seconds timeout
            this.messageTimers.set(userId, timer);
        }
        // Update buffer
        this.conversationBuffers.set(userId, buffer);
        // Show message to partner immediately (real-time display)
        const partnerSession = activeSessions.get(partnerId);
        const senderNickname = getNicknameForUser(partnerId, userId);
        partnerSession.layouts.showTextWall(`${senderNickname}: ${text}`);
    }
    cleanupUserBuffers(userId) {
        // Clear any pending timer
        const timer = this.messageTimers.get(userId);
        if (timer) {
            clearTimeout(timer);
            this.messageTimers.delete(userId);
        }
        // Save any remaining buffered message
        const buffer = this.conversationBuffers.get(userId);
        if (buffer && buffer.buffer.trim()) {
            const chatId = [userId, buffer.partnerId].sort().join('_');
            this.saveCompletedMessage(chatId, userId, buffer.buffer.trim());
        }
        // Clear buffer
        this.conversationBuffers.delete(userId);
    }
    cleanInput(text) {
        return text.replace(/[.,!?;:]$/, '').trim();
    }
    showMainMenu(session, userId) {
        const onlineFriends = this.getOnlineFriends(userId);
        let message = `Welcome!\n\n`;
        message += "ChatGlasses!\n";
        message += "• Say 'Chat [friend name]' to start a new chat\n";
        session.layouts.showTextWall(message);
        setTimeout(() => {
            session.layouts.showTextWall(" ");
        }, 5000);
    }
    showFriendsList(session, userId) {
        const userFriends = getFriends(userId);
        const onlineFriends = this.getOnlineFriends(userId);
        let message = `Your Friends:\n\n`;
        if (userFriends.length === 0) {
            message += "You have no friends in your list.";
        }
        else {
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
    getOnlineFriends(userId) {
        const userFriends = getFriends(userId);
        const onlineFriends = [];
        userFriends.forEach(friendEmail => {
            if (activeSessions.has(friendEmail)) {
                onlineFriends.push(friendEmail);
            }
        });
        return onlineFriends;
    }
    getOnlineFriendNicknames(userId) {
        const onlineFriendEmails = this.getOnlineFriends(userId);
        return onlineFriendEmails.map(email => getNicknameForUser(userId, email));
    }
    handleChatRequest(fromUserId, targetNickname) {
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
        const chatRequest = {
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
                }
                else {
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
                }
                else {
                    this.showMainMenu(toSession, targetEmail);
                }
            };
            updateTo();
        }
    }
    handleChatAccept(userId) {
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
    handleChatReject(userId) {
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
    showTemporaryMessage(session, message, duration = 5000) {
        session.layouts.showTextWall(message);
        setTimeout(() => {
            session.layouts.showTextWall("");
        }, duration);
    }
    handleEndChat(userId) {
        const partnerId = activeChatSessions.get(userId);
        if (!partnerId) {
            const session = activeSessions.get(userId);
            if (session) {
                this.showTemporaryMessage(session, "You are not in an active chat.");
            }
            return;
        }
        // Clean up buffers and timers
        this.cleanupUserBuffers(userId);
        this.cleanupUserBuffers(partnerId);
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
    handleUserDisconnect(userId) {
        // Clean up buffers
        this.cleanupUserBuffers(userId);
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
