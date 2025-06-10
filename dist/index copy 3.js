"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@augmentos/sdk");
const PACKAGE_NAME = process.env.DEV_AUGMENT_PACKAGE;
const API_KEY = process.env.DEV_AUGMENT_API_KEY;
const PORT = 81;
// User database with each user's own display name (how they want to be known by the system)
const userDatabase = new Map([
    ['ontelligency@gmail.com', 'John'],
    ['optimistic.sukanth@gmail.com', 'Girish'],
    ['abc@gmail.com', 'abc'],
    ['priya@gmail.com', 'priya'],
    ['xyz@gmail.com', 'xyz'],
    ['david@gmail.com', 'David']
]);
// Individual friend lists using email addresses (absolute userIds)
const friendLists = new Map([
    ['ontelligency@gmail.com', ['optimistic.sukanth@gmail.com', 'xyz@gmail.com', 'david@gmail.com']],
    ['optimistic.sukanth@gmail.com', ['ontelligency@gmail.com', 'xyz@gmail.com', 'abc@gmail.com', 'priya@gmail.com']],
    ['abc@gmail.com', ['optimistic.sukanth@gmail.com']],
    ['priya@gmail.com', ['optimistic.sukanth@gmail.com']],
    ['xyz@gmail.com', ['ontelligency@gmail.com', 'optimistic.sukanth@gmail.com']],
    ['david@gmail.com', ['ontelligency@gmail.com']]
]);
// Personal nickname mappings - each user can have their own nicknames for their friends
const personalNicknames = new Map([
    ['ontelligency@gmail.com', new Map([
            ['optimistic.sukanth@gmail.com', 'Girish'],
            ['xyz@gmail.com', 'girlfriend'],
            ['david@gmail.com', 'David']
        ])],
    ['optimistic.sukanth@gmail.com', new Map([
            ['ontelligency@gmail.com', "John"],
            ['xyz@gmail.com', "John's girlfriend"],
            ['priya@gmail.com', 'priya']
        ])],
    ['abc@gmail.com', new Map([
            ['optimistic.sukanth@gmail.com', 'Girish']
        ])],
    ['priya@gmail.com', new Map([
            ['optimistic.sukanth@gmail.com', 'Girish']
        ])],
    ['xyz@gmail.com', new Map([
            ['ontelligency@gmail.com', 'John']
        ])],
    ['david@gmail.com', new Map([
            ['ontelligency@gmail.com', 'John']
        ])]
]);
// Reverse lookup for email by nickname (for each user's personal nicknames)
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
// Get nickname that a user uses for another user
const getNicknameForUser = (userId, targetUserId) => {
    const userNicknames = personalNicknames.get(userId);
    // First try personal nickname, then fall back to target's own display name, then email
    return userNicknames?.get(targetUserId) || userDatabase.get(targetUserId) || targetUserId;
};
// Store active sessions
const activeSessions = new Map();
const pendingChatRequests = new Map();
const activeChatSessions = new Map(); // userId -> partnerId
class MyAugmentOSApp extends sdk_1.TpaServer {
    async onSession(session, sessionId, userId) {
        console.log(`User ${userId} connected with session ${sessionId}`);
        // Store the session
        activeSessions.set(userId, session);
        const userNickname = userDatabase.get(userId) || userId;
        // Show initial message with user's friends
        this.showMainMenu(session, userId);
        // Subscribe to transcription events for chat commands
        const unsubscribe = session.events.onTranscription((data) => {
            const text = data.text.toLowerCase().trim();
            console.log(`Command from user ${userId} (${userNickname}): ${data.text}`);
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
            else {
                // If in active chat, send message to chat partner
                const partnerId = activeChatSessions.get(userId);
                if (partnerId && activeSessions.has(partnerId)) {
                    const partnerSession = activeSessions.get(partnerId);
                    const senderNickname = getNicknameForUser(partnerId, userId); // Get nickname as seen by partner
                    partnerSession.layouts.showTextWall(`${senderNickname}: ${data.text}`);
                }
            }
        });
        // Add cleanup handler for transcription events
        this.addCleanupHandler(unsubscribe);
        // Handle disconnection
        await new Promise(resolve => {
            session.events.onDisconnected(() => {
                console.log(`User ${userId} (${userNickname}) disconnected`);
                this.handleUserDisconnect(userId);
                resolve();
            });
        });
    }
    cleanInput(text) {
        return text.replace(/[.,!?;:]$/, '').trim();
    }
    showMainMenu(session, userId) {
        const userNickname = userDatabase.get(userId) || userId;
        const onlineFriends = this.getOnlineFriends(userId);
        let message = `Welcome ${userNickname}!\n\n`;
        message += "ChatGlasses!\n";
        message += "• Say 'Chat [friend name]' to start a new chat\n";
        session.layouts.showTextWall(message);
        setTimeout(() => {
            session.layouts.showTextWall(" ");
        }, 5000);
    }
    showFriendsList(session, userId) {
        const userNickname = userDatabase.get(userId) || userId;
        const userFriends = friendLists.get(userId) || [];
        const onlineFriends = this.getOnlineFriends(userId);
        let message = `${userNickname}'s Friends:\n\n`;
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
        const userFriends = friendLists.get(userId) || [];
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
        const fromNickname = userDatabase.get(fromUserId) || fromUserId;
        const userFriends = friendLists.get(fromUserId) || [];
        // Find target email by nickname in user's personal nicknames
        const targetEmail = getUserEmailByNickname(fromUserId, targetNickname);
        if (!targetEmail) {
            const session = activeSessions.get(fromUserId);
            if (session) {
                const availableFriends = this.getOnlineFriendNicknames(fromUserId);
                session.layouts.showTextWall(`"${targetNickname}" not found in your contacts. Available friends: ${availableFriends.join(', ')}`);
            }
            return;
        }
        // Check if target is in user's friend list
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
        // Check if the target user also has the sender as a friend (mutual friendship)
        const targetFriends = friendLists.get(targetEmail) || [];
        if (!targetFriends.includes(fromUserId)) {
            const session = activeSessions.get(fromUserId);
            if (session) {
                session.layouts.showTextWall(`You can only chat with mutual friends. ${targetNickname} doesn't have you in their friend list.`);
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
        const chatRequest = {
            fromUserId,
            toUserId: targetEmail,
            fromNickname: getNicknameForUser(targetEmail, fromUserId), // Nickname as seen by target
            timestamp: Date.now()
        };
        pendingChatRequests.set(targetEmail, chatRequest);
        // Notify both users
        const fromSession = activeSessions.get(fromUserId);
        const toSession = activeSessions.get(targetEmail);
        if (fromSession) {
            let countdown = 30;
            const updateFrom = () => {
                if (!pendingChatRequests.has(targetEmail)) {
                    return; // Stop if request no longer exists
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
                    return; // Stop if request no longer exists
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
        // Remove the pending request
        pendingChatRequests.delete(userId);
        // Start the chat session
        activeChatSessions.set(chatRequest.fromUserId, userId);
        activeChatSessions.set(userId, chatRequest.fromUserId);
        const userNickname = getNicknameForUser(chatRequest.fromUserId, userId); // Nickname as seen by requester
        const fromSession = activeSessions.get(chatRequest.fromUserId);
        const toSession = activeSessions.get(userId);
        // Clear the countdown messages first
        if (fromSession) {
            fromSession.layouts.showTextWall(" "); // Clear the countdown message
        }
        if (toSession) {
            toSession.layouts.showTextWall(" "); // Clear the countdown message
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
        // Remove the pending request
        pendingChatRequests.delete(userId);
        const userNickname = getNicknameForUser(chatRequest.fromUserId, userId); // Nickname as seen by requester
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
        // End the chat for both users
        activeChatSessions.delete(userId);
        activeChatSessions.delete(partnerId);
        const userNickname = getNicknameForUser(partnerId, userId); // Nickname as seen by partner
        const partnerNickname = getNicknameForUser(userId, partnerId); // Nickname as seen by user
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
                const disconnectedUserNickname = getNicknameForUser(partnerId, userId);
                partnerSession.layouts.showTextWall(`${disconnectedUserNickname} disconnected. Chat ended.`);
                this.showMainMenu(partnerSession, partnerId);
            }
        }
        // Handle if user had pending chat requests
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
        // Remove any outgoing chat requests from this user
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
        // Notify remaining users who have this user as a friend about the disconnection
        activeSessions.forEach((session, remainingUserId) => {
            const remainingUserFriends = friendLists.get(remainingUserId) || [];
            if (remainingUserFriends.includes(userId)) {
                this.showMainMenu(session, remainingUserId);
            }
        });
    }
}
const server = new MyAugmentOSApp({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
server.start().catch(err => console.error('Failed to start server:', err));
