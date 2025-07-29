// backend/routes/api.js - DEFINITIVE, COMPLETE, AND CORRECTED VERSION

const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const OnboardingSession = require('../models/OnboardingSession');
const { OpenAI } = require('openai');

// Environment variables needed for this file's functions
const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

// =============================================================================
// == HELPER FUNCTIONS FOR THE "PAGE ACCESS TOKEN" ONBOARDING FLOW             ==
// =============================================================================

/**
 * Exchanges a short-lived page access token (from the OAuth callback)
 * for a long-lived one that lasts about 60 days.
 * @param {string} shortLivedPageToken - The temporary token for the page.
 * @returns {Promise<string>} A long-lived page access token.
 */
async function getLongLivedPageToken(shortLivedPageToken) {
    console.log('[TOKEN] Exchanging short-lived page token for a long-lived one.');
    const url = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const params = {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortLivedPageToken,
    };
    
    try {
        const response = await axios.get(url, { params });
        console.log('[TOKEN] Successfully got long-lived page token.');
        return response.data.access_token;
    } catch (error) {
        console.error('[TOKEN] FAILED to get long-lived page token:', error.response ? error.response.data : error.message);
        throw new Error('Could not secure a permanent token for the selected page.');
    }
}

/**
 * Subscribes the application's webhook to a page's 'messages' feed.
 * This uses the page's own access token to grant permission.
 * @param {string} pageId - The ID of the Instagram Business Page.
 * @param {string} pageAccessToken - The long-lived access token for that page.
 * @returns {Promise<boolean>} True if successful.
 */
async function subscribeWebhookForPage(pageId, pageAccessToken) {
    console.log(`[WEBHOOK_SUB] Attempting to subscribe page ${pageId} using its OWN Page Access Token...`);
    
    const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`;
    
    try {
        const params = new URLSearchParams();
        params.append('subscribed_fields', 'messages');
        params.append('access_token', pageAccessToken);

        await axios.post(url, params);
        console.log(`[WEBHOOK_SUB] SUCCESS: Page ${pageId} is now subscribed to app webhooks.`);
        return true;
    } catch (error) {
        console.error(`[WEBHOOK_SUB] FAILED: Reason:`, error.response ? error.response.data : error.message);
        throw new Error('Failed to subscribe the page to our application webhook.');
    }
}

// =============================================================================
// == ONBOARDING ROUTES                                                        ==
// =============================================================================

/**
 * Fetches the temporary onboarding session data for the frontend.
 */
router.get('/onboarding-session/:id', async (req, res) => {
    try {
        const session = await OnboardingSession.findById(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found or has expired. Please log in again.' });
        }
        res.json(session);
    } catch (error) {
        console.error('[ONBOARDING_SESSION_ERROR]', error);
        res.status(500).json({ error: 'Failed to fetch your session data.' });
    }
});

/**
 * Adds an email to the session if Meta couldn't provide one.
 */
router.post('/onboarding/add-email', async (req, res) => {
    const { sessionId, email } = req.body;

    if (!sessionId || !email) {
        return res.status(400).json({ error: 'Session ID and email are required.' });
    }

    try {
        const updatedSession = await OnboardingSession.findByIdAndUpdate(
            sessionId,
            { $set: { email: email } },
            { new: true }
        );

        if (!updatedSession) {
            return res.status(404).json({ error: 'Session not found or has expired.' });
        }

        res.status(200).json({ success: true, message: 'Email updated successfully.' });
    } catch (error) {
        console.error('[ADD_EMAIL_ERROR]', error);
        res.status(500).json({ error: 'Failed to save your email.' });
    }
});


/**
 * The final step of onboarding. Creates the user, gets the permanent token,
 * and subscribes the webhook.
 */
router.post('/finalize-onboarding', async (req, res) => {
    const { sessionId, selectedPageId, agreedToTerms } = req.body;

    if (!agreedToTerms) {
        return res.status(400).json({ error: 'You must agree to the Terms and Conditions to continue.' });
    }
    if (!sessionId || !selectedPageId) {
        return res.status(400).json({ error: 'Session or Page ID is missing from the request.' });
    }

    try {
        // 1. Retrieve the temporary session
        const session = await OnboardingSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Your onboarding session has expired. Please log in again.' });
        }

        // 2. Find the page the user selected
        const selectedPage = session.pages.find(p => p.id === selectedPageId);
        if (!selectedPage || !selectedPage.access_token) {
            return res.status(400).json({ error: 'The selected page is invalid or is missing authentication data.' });
        }

        // 3. Exchange the short-lived token for a long-lived one
        const longLivedPageAccessToken = await getLongLivedPageToken(selectedPage.access_token);

        // 4. Create or update the permanent User record with the long-lived token
        const user = await User.findOneAndUpdate(
            { email: session.email },
            {
                $set: {
                    name: session.name,
                    avatarUrl: session.avatarUrl,
                    'business.facebookUserId': session.facebookUserId,
                    'business.instagramPageId': selectedPage.id,
                    'business.instagramPageAccessToken': longLivedPageAccessToken, // Save the permanent token
                },
                $setOnInsert: {
                    email: session.email,
                    'business.googleSheetId': '1UH8Bwx14AkI5bvtKdUDTjCmtgDlZmM-DWeVhe1HUuiA', // Default Sheet
                    'termsAgreement': { agreedAt: new Date(), version: '1.0.0' }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // 5. Subscribe the page to webhooks using its own new, long-lived token
        await subscribeWebhookForPage(selectedPage.id, longLivedPageAccessToken);

        // 6. Clean up by deleting the temporary session
        await OnboardingSession.findByIdAndDelete(sessionId);
        
        console.log(`[FINALIZE] Successfully onboarded user ${user.email} for page ${selectedPage.id}`);
        res.json(user);

    } catch (error) {
        console.error('[FINALIZE_ERROR]', error.message);
        res.status(500).json({ error: error.message || 'An unexpected server error occurred during finalization.' });
    }
});


// =============================================================================
// == STANDARD API ROUTES FOR THE DASHBOARD                                    ==
// =============================================================================

/**
 * Gets a user's profile by their database ID.
 */
router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Fetches all conversations for a given user and platform.
 */
router.get('/conversations/:platform', async (req, res) => {
    const { platform } = req.params;
    const { userId } = req.query;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    try {
        const conversations = await Conversation.find({ userId, platform }).sort({ lastMessageTimestamp: -1 });
        res.json(conversations);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

/**
 * Toggles the AI status for a single conversation.
 */
router.patch('/conversations/:id/toggle-ai', async (req, res) => {
    const { id } = req.params;
    const { isEnabled } = req.body;
    try {
        const updatedConversation = await Conversation.findByIdAndUpdate(id, { isAiEnabled: isEnabled }, { new: true });
        if (!updatedConversation) return res.status(404).json({ error: 'Conversation not found' });
        res.json(updatedConversation);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update conversation' });
    }
});

/**
 * Fetches the global AI status for a platform (e.g., is all of Instagram on/off).
 */
router.get('/platform/:platform/status', async (req, res) => {
    // This route might need to be updated to use a real user ID from auth middleware later
    const MOCK_USER_ID = "66a9f0f67077a9a3b3c3f915"; 
    const { platform } = req.params;
    try {
        const user = await User.findById(MOCK_USER_ID);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, isEnabled: user.business.platformAiStatus[platform] });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch platform AI status' });
    }
});

/**
 * Toggles the global AI status for a platform.
 */
router.patch('/platform/:platform/toggle-ai', async (req, res) => {
    // This route might need to be updated to use a real user ID from auth middleware later
    const MOCK_USER_ID = "66a9f0f67077a9a3b3c3f915";
    const { platform } = req.params;
    const { isEnabled } = req.body;
    try {
        const user = await User.findById(MOCK_USER_ID);
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.business.platformAiStatus[platform] = isEnabled;
        await user.save();
        res.json({ success: true, isEnabled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update platform AI status' });
    }
});


/**
 * A utility route to generate a quick AI reply suggestion for the dashboard.
 */
router.post('/suggest-reply', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful business assistant." },
                { role: "user", content: prompt }
            ],
            max_tokens: 80,
        });
        const reply = completion.choices[0].message.content.trim();
        res.json({ reply });
    } catch (error) {
        console.error("Error generating AI reply:", error);
        res.status(500).json({ error: "Failed to generate AI suggestion." });
    }
});

module.exports = router;
