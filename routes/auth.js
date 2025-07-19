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

// THIS IS THE UPDATED CALLBACK FUNCTION
router.get('/instagram/callback', async (req, res) => {
    const { code } = req.query;
    console.log('[AUTH_CALLBACK] OAuth Callback Started.');

    if (!code) {
        return res.status(400).send('Error: No authorization code provided.');
    }

    try {
        const userAccessToken = await getLongLivedUserToken(code);
        const profile = await getUserProfile(userAccessToken);

        // --- THIS IS THE NEW DECISION LOGIC ---
        const hasEmail = profile.email && profile.email.length > 0;
        console.log(`[AUTH_CALLBACK] Profile received for: ${profile.name}. Email provided: ${hasEmail}`);

        const fields = 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}';
        const pagesUrl = `https://graph.facebook.com/me/accounts?fields=${fields}&access_token=${userAccessToken}`;
        const pagesResponse = await axios.get(pagesUrl);
        const userPagesWithIg = pagesResponse.data.data.filter(p => p.instagram_business_account);

        if (!userPagesWithIg || userPagesWithIg.length === 0) {
            return res.status(400).send("Could not find any Facebook Pages with a linked Instagram Business Account.");
        }

        const session = await OnboardingSession.findOneAndUpdate(
            { facebookUserId: profile.id },
            {
                name: profile.name,
                email: profile.email, // This will be null if not provided
                avatarUrl: profile.picture.data.url,
                pages: userPagesWithIg.map(p => ({
                    id: p.instagram_business_account.id,
                    name: p.instagram_business_account.username,
                    access_token: p.access_token,
                    avatar: p.instagram_business_account.profile_picture_url
                }))
            },
            { upsert: true, new: true }
        );

        // --- THIS IS THE NEW REDIRECT LOGIC ---
        if (hasEmail) {
            // If we have an email, proceed to page selection as normal.
            console.log(`[AUTH_CALLBACK] Email found. Redirecting to /select-page.`);
            res.redirect(`${process.env.FRONTEND_URL}/select-page?sessionId=${session._id}`);
        } else {
            // If no email, redirect to the new "enter email" screen.
            console.log(`[AUTH_CALLBACK] NO email found. Redirecting to /enter-email.`);
            res.redirect(`${process.env.FRONTEND_URL}/enter-email?sessionId=${session._id}`);
        }

    } catch (error) {
        console.error('\n--- FATAL OAUTH CALLBACK ERROR ---');
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).send('An error occurred during authentication.');
    }
});

module.exports = router;
