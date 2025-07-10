// backend/routes/webhook.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const PYTHON_API_BASE_URL = process.env.PYTHON_API_BASE_URL;
process.env.PYTHON_API_BASE_URL.trim() : null;
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
            // Log each entry to see how many we are getting
            console.log(`[Webhook] Processing entry ID: ${entry.id}`);
            
            return entry.messaging.map(event => {
                // Log each event to see how many we are getting
                console.log(`[Webhook] Processing event for sender: ${event.sender.id}`);

                if (event.message && !event.message.is_echo) {
                    // Return the promise from processInstagramMessage
                    return processInstagramMessage(event);
                }
                // Return a resolved promise for events we don't care about
                return Promise.resolve(); 
            });
        }).flat(); // Flatten the array of promises

        // Wait for all messages to be processed, but don't hold up the response
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

    // This is a more robust check for echoes.
    if (event.message.is_echo) {
        console.log(`[Webhook] Ignoring an echo message for page ${pageId}.`);
        return; // Stop processing immediately
    }

    if (!messageText) {
        console.log(`[Webhook] Ignoring a non-text message (e.g., a sticker or reaction).`);
        return; // Stop processing
    }

    console.log(`[Webhook] Processing inbound message: "${messageText}" from ${customerId} for page ${pageId}`);

    try {
        const client = await User.findOne({ 'business.instagramPageId': pageId });
        if (!client) {
            console.error(`[Webhook] ERROR: No client found for Instagram page ID: ${pageId}`);
            return;
        }
        console.log(`[Webhook] Matched message to client: ${client.email}`);

        if (!client.business.platformAiStatus.instagram) {
            console.log(`[Webhook] Global AI is disabled for client ${client.email}. Aborting.`);
            return;
        }

        const conversation = await Conversation.findOneAndUpdate(
            { userId: client._id, contactId: customerId, platform: 'instagram' },
            { $set: { lastMessage: messageText, lastMessageTimestamp: new Date(event.timestamp) } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (!conversation.isAiEnabled) {
            console.log(`[Webhook] AI is disabled for specific conversation with contact ${customerId}. Aborting.`);
            return;
        }

        console.log(`[Webhook] All checks passed. Calling Python AI service.`);
        await callPythonAiService(
            customerId, 
            messageText, 
            client.business.googleSheetId,
            client.business.instagramPageAccessToken
        );

    } catch (error)
    {
        console.error('[Webhook] CRITICAL ERROR processing Instagram message:', error);
    }
}

// Upgraded function to call our Python Microservice with the page token
async function callPythonAiService(customerId, messageText, sheetId, pageAccessToken) {
    try {
        await axios.post(
            `${PYTHON_API_BASE_URL}/api/process-message`,
            {
                user_id: customerId, // This is the ID of the end-user/customer
                message_text: messageText,
                sheet_id: sheetId,
                page_access_token: pageAccessToken // Pass the required token
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Internal-API-Key': PYTHON_INTERNAL_API_KEY
                }
            }
        );
        console.log('[Webhook] Successfully called Python service.');
    } catch (error) {
        const errorMsg = error.response ? error.response.data : error.message;
        console.error('[Webhook] FAILED to call Python AI service:', errorMsg);
    }
}

module.exports = router;
