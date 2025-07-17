// backend/routes/webhook.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const PYTHON_API_BASE_URL = process.env.PYTHON_API_BASE_URL;
const PYTHON_INTERNAL_API_KEY = process.env.PYTHON_INTERNAL_API_KEY;

// Webhook Verification Endpoint
router.get('/', (req, res) => {
    console.log('\n[WEBHOOK GET] Received a verification request from Meta.');

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log(`[WEBHOOK GET] Mode: ${mode}`);
    console.log(`[WEBHOOK GET] Token from Meta: ${token}`);
    console.log(`[WEBHOOK GET] My Server's Token: ${META_VERIFY_TOKEN}`);
    console.log(`[WEBHOOK GET] Challenge: ${challenge}`);

    if (mode && token) {
        if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
            console.log('[WEBHOOK GET] SUCCESS: Tokens match. Responding with challenge.');
            res.status(200).send(challenge);
        } else {
            console.error('[WEBHOOK GET] FAILED: Tokens do not match or mode is not "subscribe".');
            res.sendStatus(403); // Forbidden
        }
    } else {
        console.error('[WEBHOOK GET] FAILED: Missing mode or token from Meta query parameters.');
        res.sendStatus(400); // Bad Request
    }
});

// Webhook Event Handler
router.post('/', (req, res) => {
    const body = req.body;
    
    // Immediately acknowledge the event to prevent Meta retries.
    res.status(200).send('EVENT_RECEIVED');

    if (body.object === 'instagram') {
        console.log('[Webhook] Received an Instagram event.');

        const messageProcessingPromises = body.entry.map(entry => {
            console.log(`[Webhook] Processing entry ID: ${entry.id}`);
            
            return entry.messaging.map(event => {
                console.log(`[Webhook] Processing event for sender: ${event.sender.id}`);

                if (event.message && !event.message.is_echo) {
                    return processInstagramMessage(event);
                }
                return Promise.resolve(); 
            });
        }).flat();

        Promise.all(messageProcessingPromises).catch(err => {
            console.error('[Webhook] An error occurred in the processing pipeline:', err);
        });

    } else {
        console.warn(`[Webhook] Received an event for an object other than Instagram: ${body.object}`);
    }
});

// The upgraded multi-tenant Core Logic Function
async function processInstagramMessage(event) {
    const customerId = event.sender.id;
    const pageId = event.recipient.id;
    const messageText = event.message.text;

    // Skip echoes and non-text messages
    if (event.message.is_echo || !messageText) {
        return;
    }

    console.log(`[Webhook] Processing inbound message: "${messageText}" from ${customerId} for page ${pageId}`);

    try {
        const client = await User.findOne({ 'business.instagramPageId': pageId });
        if (!client) {
            console.error(`[Webhook] ERROR: No client found for Instagram page ID: ${pageId}`);
            return;
        }
        console.log(`[Webhook] Matched message to client: ${client.email}`);

        // --- UPGRADED CONVERSATION HANDLING LOGIC ---
        let conversation = await Conversation.findOne({
            userId: client._id,
            contactId: customerId,
            platform: 'instagram'
        });

        // If it's a NEW conversation, fetch the user's profile info first
        if (!conversation) {
            console.log(`[Webhook] New conversation detected. Fetching profile for contact ID: ${customerId}`);
            
            // Fetch Instagram profile details
            const userProfile = await getInstagramUserProfile(
                customerId, 
                client.business.instagramPageAccessToken
            );
            
            // Create new conversation with enriched data
            conversation = await Conversation.create({
                userId: client._id,
                platform: 'instagram',
                contactId: customerId,
                contactName: userProfile.name,
                contactAvatarUrl: userProfile.avatarUrl,
                lastMessage: messageText,
                lastMessageTimestamp: new Date(event.timestamp)
            });
            
            console.log(`[Webhook] Created new conversation for: ${userProfile.name}`);
        } else {
            // Existing conversation - just update the last message
            conversation.lastMessage = messageText;
            conversation.lastMessageTimestamp = new Date(event.timestamp);
            await conversation.save();
        }
        // --- END OF UPGRADED LOGIC ---

        // Check if AI is enabled for this conversation
        if (!client.business.platformAiStatus.instagram || !conversation.isAiEnabled) {
            console.log(`[Webhook] AI is disabled for this client or conversation. Aborting.`);
            return;
        }

        console.log(`[Webhook] All checks passed. Calling Python AI service.`);
        await callPythonAiService(customerId, messageText, client);

    } catch (error) {
        console.error('[Webhook] CRITICAL ERROR processing Instagram message:', error);
    }
}

// Upgraded function to call our Python Microservice with the page token
async function callPythonAiService(customerId, messageText, client) {
    try {
        if (!PYTHON_API_BASE_URL) {
            throw new Error("PYTHON_API_BASE_URL environment variable not set!");
        }

        const finalUrl = `${PYTHON_API_BASE_URL}/api/process-message`;
        console.log(`[Webhook] Preparing to call Python AI at: ${finalUrl}`);
        
        const payload = {
            user_id: customerId,
            message_text: messageText,
            sheet_id: client.business.googleSheetId,
            page_access_token: client.business.instagramPageAccessToken,
            booking_integration: {
                provider: client.business.bookingIntegration.provider,
                api_key: client.business.bookingIntegration.apiKey
            }
        };

        await axios.post(finalUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-API-Key': PYTHON_INTERNAL_API_KEY
            }
        });
        console.log('[Webhook] Successfully called Python service.');
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('[Webhook] FAILED to call Python AI service:', errorMsg);
    }
}

// NEW HELPER FUNCTION: Fetch Instagram user profile details
async function getInstagramUserProfile(userId, pageAccessToken) {
    try {
        const url = `https://graph.facebook.com/${userId}?fields=name,profile_pic&access_token=${pageAccessToken}`;
        const response = await axios.get(url);
        const userData = response.data;
        
        return {
            name: userData.name,
            avatarUrl: userData.profile_pic
        };
    } catch (error) {
        console.error(`[Webhook] Failed to fetch profile for user ${userId}:`, 
                      error.response ? error.response.data : error.message);
        
        // Return defaults if the call fails
        return {
            name: `User ${userId.slice(-4)}`, // Partial ID for identification
            avatarUrl: 'https://picsum.photos/seed/placeholder/100/100' // Generic placeholder
        };
    }
}

module.exports = router;
