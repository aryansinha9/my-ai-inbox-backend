const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const OnboardingSession = require('../models/OnboardingSession'); // ADDED

// For now, we will mock the user login. In a real app, you'd implement JWT authentication.
const MOCK_USER_ID = "66a9f0f67077a9a3b3c3f915"; // Replace with an actual ID from your DB later

// POST /api/login - (Currently a mock, returns a hardcoded user)
router.post('/login', async (req, res) => {
    try {
        // In a real app, you would find user by email and verify password
        // For now, let's create/find a dummy user to work with
        let user = await User.findOne({ email: 'jane.doe@example.com' });
        if (!user) {
            user = await User.create({
                _id: MOCK_USER_ID,
                name: 'Jane Doe',
                email: 'jane.doe@example.com',
                avatarUrl: 'https://picsum.photos/seed/janedoe/100/100',
                business: {
                    name: "Jane's Barbershop",
                    googleSheetId: 'YOUR_GOOGLE_SHEET_ID_HERE', // <-- IMPORTANT: Put your client's sheet ID here
                    instagramPageId: 'YOUR_INSTAGRAM_PAGE_ID_HERE', // <-- IMPORTANT
                }
            });
        }
        res.json(user);
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/conversations/:platform - NOW DYNAMIC
// Expects a userId to be passed as a query parameter, like:
// /api/conversations/instagram?userId=12345
router.get('/conversations/:platform', async (req, res) => {
    const { platform } = req.params;
    const { userId } = req.query; // Get userId from query params

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        console.log(`[API] Fetching conversations for user ${userId} on platform ${platform}`);
        const conversations = await Conversation.find({ userId: userId, platform: platform })
            .sort({ lastMessageTimestamp: -1 });
        
        console.log(`[API] Found ${conversations.length} conversations.`);
        res.json(conversations);
    } catch (error) {
        console.error(`[API] Error fetching conversations for user ${userId}:`, error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

router.get('/platform/:platform/status', async (req, res) => {
    const { platform } = req.params;
    try {
        // TODO: Replace MOCK_USER_ID with authenticated user ID
        const user = await User.findById(MOCK_USER_ID);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const isEnabled = user.business.platformAiStatus[platform];
        res.json({ success: true, isEnabled });

    } catch (error) {
        console.error(`Error fetching platform AI status for ${platform}:`, error);
        res.status(500).json({ error: 'Failed to fetch platform AI status' });
    }
});

// PATCH /api/platform/:platform/toggle-ai
router.patch('/platform/:platform/toggle-ai', async (req, res) => {
    const { platform } = req.params;
    const { isEnabled } = req.body;
    try {
        // TODO: Replace MOCK_USER_ID with authenticated user ID
        const user = await User.findById(MOCK_USER_ID);
        if (!user) return res.status(404).json({ error: 'User not found' });

        user.business.platformAiStatus[platform] = isEnabled;
        await user.save();
        
        // Also update all conversations for that user and platform
        await Conversation.updateMany(
            { userId: MOCK_USER_ID, platform },
            { $set: { isAiEnabled: isEnabled } }
        );

        res.json({ success: true, isEnabled });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update platform AI status' });
    }
});

// PATCH /api/conversations/:id/toggle-ai
router.patch('/conversations/:id/toggle-ai', async (req, res) => {
    const { id } = req.params;
    const { isEnabled } = req.body;
    try {
        const updatedConversation = await Conversation.findByIdAndUpdate(
            id,
            { isAiEnabled: isEnabled },
            { new: true }
        );
        if (!updatedConversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.json(updatedConversation);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update conversation' });
    }
});

// GET /api/user/:id - Fetches a user's data by their database ID
router.get('/user/:id', async (req, res) => {
    try {
        console.log(`[API] Received request to get user by ID: ${req.params.id}`);
        const user = await User.findById(req.params.id);
        if (!user) {
            console.error(`[API] User with ID ${req.params.id} not found.`);
            return res.status(404).json({ error: 'User not found' });
        }
        console.log(`[API] Found user: ${user.email}`);
        res.json(user);
    } catch (error) {
        console.error(`[API] Error fetching user by ID: ${req.params.id}`, error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/finalize-onboarding - NEW ENDPOINT
router.post('/finalize-onboarding', async (req, res) => {
    const { sessionId, selectedPageId } = req.body;

    if (!sessionId || !selectedPageId) {
        return res.status(400).json({ error: 'Session ID and Selected Page ID are required.' });
    }

    try {
        // 1. Find the temporary session
        const session = await OnboardingSession.findById(sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Onboarding session not found or expired.' });
        }

        // 2. Find the specific page the user selected from the session's page list
        const selectedPage = session.pages.find(p => p.id === selectedPageId);
        if (!selectedPage) {
            return res.status(400).json({ error: 'Selected page not found in session.' });
        }

        // 3. Create or Update the permanent User record
        const user = await User.findOneAndUpdate(
            { email: session.email }, // Use email as the primary key for finding the user
            {
                name: session.name,
                email: session.email,
                avatarUrl: session.avatarUrl,
                'business.facebookUserId': session.facebookUserId,
                'business.instagramPageId': selectedPage.id,
                'business.instagramPageAccessToken': selectedPage.access_token,
                // You can collect this in a later step, for now use a placeholder
                'business.googleSheetId': '1UH8Bwx14AkI5bvtKdUDTjCmtgDlZmM-DWeVhe1HUuiA',
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // 4. Delete the temporary session
        await OnboardingSession.findByIdAndDelete(sessionId);

        // 5. Send the complete user object back to the frontend
        res.json(user);

    } catch (error) {
        console.error('[FINALIZE ERROR]', error);
        res.status(500).json({ error: 'Failed to finalize onboarding.' });
    }
});

module.exports = router;
