// backend/routes/api.js -> FULL DIAGNOSTIC VERSION

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const OnboardingSession = require('../models/OnboardingSession');
const { OpenAI } = require('openai');

const MOCK_USER_ID = "66a9f0f67077a9a3b3c3f915";

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

router.post('/finalize-onboarding', async (req, res) => {
    // --- STEP 1: LOG THE INITIAL REQUEST ---
    console.log('[FINALIZE] Received request to finalize onboarding.');
    const { sessionId, selectedPageId, agreedToTerms } = req.body;
    console.log(`[FINALIZE] Session ID: ${sessionId}, Page ID: ${selectedPageId}, Agreed: ${agreedToTerms}`);

    if (!agreedToTerms) return res.status(400).json({ error: 'You must agree to the Terms and Conditions to continue.' });
    if (!sessionId || !selectedPageId) return res.status(400).json({ error: 'Session ID and Selected Page ID are required.' });

    try {
        // --- STEP 2: LOG THE DATABASE SESSION RETRIEVAL ---
        console.log('[FINALIZE] Attempting to find OnboardingSession in database...');
        const session = await OnboardingSession.findById(sessionId);
        if (!session) {
            console.error('[FINALIZE] FATAL: Onboarding session not found in DB.');
            return res.status(404).json({ error: 'Onboarding session not found or expired. Please log in again.' });
        }
        console.log('[FINALIZE] Success! Found OnboardingSession. Logging entire session object:');
        console.log(JSON.stringify(session, null, 2));

        const selectedPage = session.pages.find(p => p.id === selectedPageId);
        if (!selectedPage) {
            console.error('[FINALIZE] FATAL: Selected page ID not found within the session pages array.');
            return res.status(400).json({ error: 'Selected page not found in session.' });
        }
        console.log('[FINALIZE] Success! Found selected page. Logging selected page object:');
        console.log(JSON.stringify(selectedPage, null, 2));

        // --- STEP 3: LOG THE DATA JUST BEFORE THE FINAL DATABASE WRITE ---
        console.log('[FINALIZE] All checks passed. Preparing data for final user creation...');
        const finalUserData = {
            name: session.name,
            email: session.email,
            avatarUrl: session.avatarUrl,
            facebookUserId: session.facebookUserId,
            instagramPageId: selectedPage.id,
            instagramPageAccessToken: selectedPage.access_token,
        };
        console.log('[FINALIZE] Data to be written to User model:');
        console.log(JSON.stringify(finalUserData, null, 2));

        // --- STEP 4: ATTEMPT THE DATABASE WRITE ---
        console.log('[FINALIZE] Executing User.findOneAndUpdate...');
        const user = await User.findOneAndUpdate(
            { email: session.email },
            {
                $set: {
                    name: finalUserData.name,
                    avatarUrl: finalUserData.avatarUrl,
                    'business.facebookUserId': finalUserData.facebookUserId,
                    'business.instagramPageId': finalUserData.instagramPageId,
                    'business.instagramPageAccessToken': finalUserData.instagramPageAccessToken,
                },
                $setOnInsert: {
                    email: finalUserData.email,
                    'business.googleSheetId': '1UH8Bwx14AkI5bvtKdUDTjCmtgDlZmM-DWeVhe1HUuiA',
                    'termsAgreement': { agreedAt: new Date(), version: '1.0.0' }
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log('[FINALIZE] SUCCESS! User document created/updated.');

        await OnboardingSession.findByIdAndDelete(sessionId);
        console.log('[FINALIZE] Onboarding session deleted. Sending success response to frontend.');
        res.json(user);

    } catch (error) {
        // --- STEP 5: LOG THE EXACT ERROR ---
        console.error('--- [FINALIZE] CRITICAL ERROR CAUGHT ---');
        console.error(`Error Name: ${error.name}`);
        console.error(`Error Code: ${error.code}`);
        console.error(`Error Message: ${error.message}`);
        console.error('Full Error Object:', error);
        console.error('--- END OF CRITICAL ERROR ---');
        
        if (error.code === 11000) {
            if (error.keyPattern && error.keyPattern['business.instagramPageId']) {
                return res.status(409).json({ error: 'This Instagram Page is already connected to another account.' });
            }
        }
        
        res.status(500).json({ error: 'An unexpected error occurred on the server.' });
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

router.post('/suggest-reply', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'A prompt is required.' });

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful business assistant..." },
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
