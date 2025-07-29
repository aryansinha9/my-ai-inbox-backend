// backend/routes/api.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const OnboardingSession = require('../models/OnboardingSession');
const { OpenAI } = require('openai');

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const META_SYSTEM_USER_TOKEN = process.env.META_SYSTEM_USER_TOKEN;
const MOCK_USER_ID = "66a9f0f67077a9a3b3c3f915";

// --- NEW HELPER FUNCTION: Get a Long-Lived PAGE Access Token ---
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
        throw new Error('Could not secure a long-lived token for the page.');
    }
}

// --- REWRITTEN HELPER FUNCTION: Subscribe Webhook using the PAGE Token ---
async function subscribeWebhookForPage(pageId, pageAccessToken) {
    console.log(`[WEBHOOK_SUB] Attempting to subscribe page ${pageId} using its OWN Page Access Token...`);
    
    const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`;
    
    try {
        const params = new URLSearchParams();
        params.append('subscribed_fields', 'messages');
        params.append('access_token', pageAccessToken);

        await axios.post(url, params);
        console.log(`[WEBHOOK_SUB] SUCCESS: Page ${pageId} is now subscribed.`);
        return true;
    } catch (error) {
        console.error(`[WEBHOOK_SUB] FAILED: Reason:`, error.response ? error.response.data : error.message);
        throw new Error('Failed to subscribe page to webhooks.');
    }
}

router.post('/login', async (req, res) => {
    try {
        let user = await User.findOne({ email: 'jane.doe@example.com' });
        if (!user) {
            user = await User.create({
                _id: MOCK_USER_ID,
                name: 'Jane Doe',
                email: 'jane.doe@example.com',
                avatarUrl: 'https://picsum.photos/seed/janedoe/100/100',
                business: {
                    name: "Jane's Barbershop",
                    googleSheetId: 'YOUR_GOOGLE_SHEET_ID_HERE',
                    instagramPageId: 'YOUR_INSTAGRAM_PAGE_ID_HERE',
                    instagramPageAccessToken: 'DUMMY_TOKEN'
                },
                termsAgreement: {
                    agreedAt: new Date()
                }
            });
        }
        res.json(user);
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

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

router.get('/platform/:platform/status', async (req, res) => {
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

router.patch('/platform/:platform/toggle-ai', async (req, res) => {
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

router.get('/user/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/onboarding-session/:id', async (req, res) => {
    try {
        const session = await OnboardingSession.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
        res.json(session);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch session.' });
    }
});

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
            return res.status(404).json({ error: 'Session not found or expired.' });
        }

        console.log(`[API] Successfully added email ${email} to session ${sessionId}`);
        res.status(200).json({ success: true, message: 'Email updated successfully.' });
    } catch (error) {
        console.error('[ADD_EMAIL_ERROR]', error);
        res.status(500).json({ error: 'Failed to update session with email.' });
    }
});

// --- COMPLETELY REWRITTEN /finalize-onboarding ROUTE ---
router.post('/finalize-onboarding', async (req, res) => {
    const { sessionId, selectedPageId, agreedToTerms } = req.body;

    if (!agreedToTerms) return res.status(400).json({ error: 'You must agree to the Terms and Conditions.' });
    if (!sessionId || !selectedPageId) return res.status(400).json({ error: 'Session or Page ID is missing.' });

    try {
        const session = await OnboardingSession.findById(sessionId);
        if (!session) return res.status(404).json({ error: 'Onboarding session expired. Please log in again.' });

        const selectedPage = session.pages.find(p => p.id === selectedPageId);
        if (!selectedPage || !selectedPage.access_token) {
            return res.status(400).json({ error: 'Selected page is invalid or missing a token.' });
        }

        // Step A: Exchange the short-lived page token for a long-lived one
        const longLivedPageAccessToken = await getLongLivedPageToken(selectedPage.access_token);

        // Step B: Create or update the user with the long-lived token
        const user = await User.findOneAndUpdate(
            { email: session.email },
            {
                $set: {
                    name: session.name,
                    avatarUrl: session.avatarUrl,
                    'business.facebookUserId': session.facebookUserId,
                    'business.instagramPageId': selectedPage.id,
                    'business.instagramPageAccessToken': longLivedPageAccessToken,
                },
                $setOnInsert: {
                    email: session.email,
                    'business.googleSheetId': '1UH8Bwx14AkI5bvtKdUDTjCmtgDlZmM-DWeVhe1HUuiA',
                    'termsAgreement': { agreedAt: new Date(), version: '1.0.0' }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Step C: Subscribe the page to webhooks using its own token
        await subscribeWebhookForPage(selectedPage.id, longLivedPageAccessToken);

        // Step D: Clean up session
        await OnboardingSession.findByIdAndDelete(sessionId);
        
        console.log(`[FINALIZE] Successfully onboarded user ${user.email} for page ${selectedPage.id}`);
        res.json(user);

    } catch (error) {
        console.error('[FINALIZE_ERROR]', error.message);
        res.status(500).json({ error: error.message || 'An unexpected server error occurred during finalization.' });
    }
});

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
        res.status(500).json({ error: "Failed to generate AI suggestion." });
    }
});

module.exports = router;
