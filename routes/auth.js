// backend/routes/auth.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const User = require('../models/User');
const OnboardingSession = require('../models/OnboardingSession');

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = `${process.env.SERVER_URL}/api/auth/instagram/callback`;

// Helper function to get the user's profile
async function getUserProfile(accessToken) {
    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`;
    const response = await axios.get(profileUrl);
    return response.data;
}

// Helper function to get a long-lived user token
async function getLongLivedUserToken(code) {
    // Exchange code for short-lived token
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const tokenParams = {
        client_id: FB_APP_ID,
        redirect_uri: REDIRECT_URI,
        client_secret: FB_APP_SECRET,
        code
    };
    const tokenResponse = await axios.get(tokenUrl, { params: tokenParams });
    const shortLivedToken = tokenResponse.data.access_token;

    // Exchange short-lived for long-lived token
    const longLivedUrl = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const longLivedParams = {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortLivedToken
    };
    const longLivedResponse = await axios.get(longLivedUrl, { params: longLivedParams });
    return longLivedResponse.data.access_token;
}

// Route #1: Kicks off the OAuth flow
router.get('/instagram', (req, res) => {
    console.log('\n[DEBUG] --- /api/auth/instagram route hit! ---');
    if (!FB_APP_ID) {
        console.error('[DEBUG] FATAL: Facebook App ID is not set.');
        return res.status(500).send('Configuration Error: Facebook App ID is not set on the server.');
    }
    
    const scopes = [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_show_list',
        'pages_manage_metadata',
        'business_management',
        'email',
        'public_profile'
    ];
    
    const scopeString = scopes.join(',');
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${REDIRECT_URI}&scope=${scopeString}`;
    console.log('[DEBUG] Redirecting user to Facebook...');
    res.redirect(authUrl);
});

// Route #2: The UPGRADED callback - Step 1 of Onboarding
router.get('/instagram/callback', async (req, res) => {
    const { code } = req.query;
    console.log('[DEBUG] --- OAuth Callback Started (Page Selection Flow) ---');

    if (!code) {
        return res.status(400).send('Error: No authorization code provided.');
    }

    try {
        // Step 1: Get user token and profile
        const userAccessToken = await getLongLivedUserToken(code);
        const profile = await getUserProfile(userAccessToken);
        console.log(`[DEBUG] Got profile for: ${profile.email}`);

        // Step 2: Get ALL of the user's managed pages AND their linked Instagram accounts
        // --- THIS IS THE FIX ---
        const fields = 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}';
        const pagesUrl = `https://graph.facebook.com/me/accounts?fields=${fields}&access_token=${userAccessToken}`;
        // --- END OF FIX ---
        
        const pagesResponse = await axios.get(pagesUrl);
        
        // Filter out pages that do NOT have an Instagram account linked
        const userPagesWithIg = pagesResponse.data.data.filter(p => p.instagram_business_account);

        if (!userPagesWithIg || userPagesWithIg.length === 0) {
            return res.status(400).send("Could not find any Facebook Pages with a linked Instagram Business Account.");
        }
        console.log(`[DEBUG] Found ${userPagesWithIg.length} pages with linked Instagram accounts.`);

        // Step 3: Save this richer information to the temporary OnboardingSession
        const session = await OnboardingSession.findOneAndUpdate(
            { facebookUserId: profile.id },
            {
                name: profile.name,
                email: profile.email,
                avatarUrl: profile.picture.data.url,
                // Now we save the Instagram details instead of the Facebook Page details
                pages: userPagesWithIg.map(p => ({
                    id: p.instagram_business_account.id, // Save the INSTAGRAM ID
                    name: p.instagram_business_account.username, // Save the INSTAGRAM USERNAME
                    access_token: p.access_token, // The Page Access Token is still what we need
                    avatar: p.instagram_business_account.profile_picture_url // Save Instagram profile picture
                }))
            },
            { upsert: true, new: true }
        );

        // Step 4: Redirect to page selection UI
        console.log(`[DEBUG] Redirecting to page selection for session ID: ${session._id}`);
        res.redirect(`${process.env.FRONTEND_URL}/select-page?sessionId=${session._id}`);

    } catch (error) {
        console.error('\n--- FATAL OAUTH CALLBACK ERROR ---');
        if (error.response) {
            console.error('[DEBUG] Axios Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('[DEBUG] Non-Axios Error:', error.message);
        }
        res.status(500).send('An error occurred during authentication. Check the backend server logs.');
    }
});

module.exports = router;
