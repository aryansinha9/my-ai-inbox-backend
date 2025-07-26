// backend/routes/api.js -> FINAL PRODUCTION VERSION
const express = require('express');
const router = express.Router();
const axios = require('axios'); // Added for webhook subscription
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const OnboardingSession = require('../models/OnboardingSession');
const { OpenAI } = require('openai');

// System token for Meta API administrative actions
const META_SYSTEM_USER_TOKEN = process.env.META_SYSTEM_USER_TOKEN;

// This mock user is for development/testing. In a real app, you'd use req.user from an auth middleware.
const MOCK_USER_ID = "66a9f0f67077a9a3b3c3f915";

// --- HELPER FUNCTION FOR AUTOMATED WEBHOOK SUBSCRIPTION ---
async function subscribeWebhookForPage(pageId) {
    console.log(`[WEBHOOK_SUB] Attempting to subscribe page ${pageId} with System User Token...`);
    const url = `https://graph.facebook.com/v19.0/${pageId}/subscribed_apps`;
    try {
        // Use form-urlencoded data as per Meta's API documentation for this endpoint
        const params = new URLSearchParams();
        params.append('subscribed_fields', 'messages');
        // --- THIS IS THE CRITICAL CHANGE ---
        // Use the powerful System User Token for this administrative action.
        params.append('access_token', META_SYSTEM_USER_TOKEN);

        await axios.post(url, params);
        console.log(`[WEBHOOK_SUB] SUCCESS: Page ${pageId} is now subscribed.`);
        return true;
    } catch (error) {
        console.error(`[WEBHOOK_SUB] FAILED: Could not subscribe page ${pageId}. Reason:`, error.response ? error.response.data : error.message);
        return false;
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

router.post('/finalize-onboarding', async (req, res) => {
    const { sessionId, selectedPageId, agreedToTerms } = req.body;

    if (!agreedToTerms) return res.status(400).json({ error: 'You must agree to the Terms and Conditions to continue.' });
    if (!sessionId || !selectedPageId) return res.status(400).json({ error: 'Session ID and Selected Page ID are required.' });

    try {
        const session = await OnboardingSession.findById(sessionId);
        if (!session) return res.status(404).json({ error: 'Onboarding session not found or expired. Please log in again.' });

        const selectedPage = session.pages.find(p => p.id === selectedPageId);
        if (!selectedPage) return res.status(400).json({ error: 'Selected page not found in session.' });

        if (!session.email) return res.status(400).json({ error: 'Could not retrieve email from your social profile. Please ensure it is public and try again.' });
        if (!session.name) return res.status(400).json({ error: 'Could not retrieve name from your social profile. Please ensure it is public and try again.' });
        if (!selectedPage.access_token) return res.status(400).json({ error: 'Could not retrieve valid access token for the selected page.' });

        const user = await User.findOneAndUpdate(
            { email: session.email },
            {
                $set: {
                    name: session.name,
                    avatarUrl: session.avatarUrl,
                    'business.facebookUserId': session.facebookUserId,
                    'business.instagramPageId': selectedPage.id,
                    'business.instagramPageAccessToken': selectedPage.access_token,
                },
                $setOnInsert: {
                    email: session.email,
                    'business.googleSheetId': '1UH8Bwx14AkI5bvtKdUDTjCmtgDlZmM-DWeVhe1HUuiA',
                    'termsAgreement': { agreedAt: new Date(), version: '1.0.0' }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // AUTOMATIC WEBHOOK SUBSCRIPTION
        try {
            console.log(`[ONBOARDING] Attempting webhook subscription for page: ${selectedPage.id}`);
            // Updated to use system token (no longer passing page token)
            await subscribeWebhookForPage(selectedPage.id);
            console.log(`[ONBOARDING] Webhook subscription successful for page: ${selectedPage.id}`);
        } catch (webhookError) {
            console.error(`[ONBOARDING] Webhook subscription failed for page ${selectedPage.id}:`, webhookError.message);
            // Continue even if webhook subscription fails - we'll log but not block user
        }

        await OnboardingSession.findByIdAndDelete(sessionId);
        res.json(user);

    } catch (error) {
        console.error('[FINALIZE_ERROR]', error.message);

        if (error.code === 11000) {
            if (error.keyPattern && error.keyPattern['business.instagramPageId']) {
                return res.status(409).json({ error: 'This Instagram Page is already connected to another account.' });
            }
        }
        
        if (error.name === 'ValidationError') {
            return res.status(400).json({ error: 'A required field was missing. Please try logging in again.' });
        }
        
        res.status(500).json({ error: 'An unexpected server error occurred. Please try again later.' });
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
