// backend/routes/auth.js - DEFINITIVE CORRECTED VERSION

const express = require('express');
const axios = require('axios');
const router = express.Router();
const OnboardingSession = require('../models/OnboardingSession');

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = `${process.env.SERVER_URL}/api/auth/instagram/callback`;

// Helper to get a long-lived USER token (this token is just for the onboarding steps)
async function getLongLivedUserToken(code) {
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const tokenParams = { client_id: FB_APP_ID, redirect_uri: REDIRECT_URI, client_secret: FB_APP_SECRET, code };
    const tokenResponse = await axios.get(tokenUrl, { params: tokenParams });
    const shortLivedToken = tokenResponse.data.access_token;

    const longLivedUrl = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const longLivedParams = { grant_type: 'fb_exchange_token', client_id: FB_APP_ID, client_secret: FB_APP_SECRET, fb_exchange_token: shortLivedToken };
    const longLivedResponse = await axios.get(longLivedUrl, { params: longLivedParams });
    return longLivedResponse.data.access_token;
}

// Helper to get the user's basic profile
async function getUserProfile(accessToken) {
    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`;
    const response = await axios.get(profileUrl);
    return response.data;
}

// --- OAUTH START ROUTE (Correct for Page Token Flow) ---
router.get('/instagram', (req, res) => {
    console.log('[AUTH_START] Page Access Token OAuth flow initiated.');
    
    const scopes = [
        'instagram_basic',
        'instagram_manage_messages',
        'pages_show_list',
        'pages_manage_metadata',
        'email',
        'public_profile',
        'pages_messaging'
    ];
    
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${REDIRECT_URI}&scope=${scopes.join(',')}`;
    
    console.log('[AUTH_START] Redirecting user for standard page permissions.');
    res.redirect(authUrl);
});

// --- OAUTH CALLBACK (Simplified and Corrected) ---
router.get('/instagram/callback', async (req, res) => {
    const { code } = req.query;
    console.log('[AUTH_CALLBACK] OAuth Callback Started.');

    if (!code) return res.status(400).send('Error: No authorization code provided.');

    try {
        const userAccessToken = await getLongLivedUserToken(code);
        const profile = await getUserProfile(userAccessToken);
        const hasEmail = profile.email && profile.email.length > 0;

        // Fetch pages with their SHORT-LIVED page access tokens.
        // These tokens will be exchanged for long-lived ones in the finalization step.
        const pagesUrl = `https://graph.facebook.com/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${userAccessToken}`;
        const pagesResponse = await axios.get(pagesUrl);
        
        // Filter for pages that have an Instagram account connected
        const userPagesWithIg = pagesResponse.data.data.filter(p => p.instagram_business_account);

        if (userPagesWithIg.length === 0) {
            return res.status(400).send("No Instagram Business Accounts were found linked to your Facebook Pages. Please ensure your Instagram account is a 'Business' account and is connected to a Facebook Page in your settings.");
        }

        // Save the session data. We are NO LONGER checking for businessId.
        const session = await OnboardingSession.findOneAndUpdate(
            { facebookUserId: profile.id },
            {
                name: profile.name,
                email: profile.email,
                avatarUrl: profile.picture.data.url,
                pages: userPagesWithIg.map(p => ({
                    id: p.instagram_business_account.id,
                    name: p.instagram_business_account.username,
                    access_token: p.access_token, // This is the short-lived PAGE token
                    avatar: p.instagram_business_account.profile_picture_url
                }))
            },
            { upsert: true, new: true }
        );

        // Redirect to the frontend to let the user select a page
        if (hasEmail) {
            res.redirect(`${process.env.FRONTEND_URL}/select-page?sessionId=${session._id}`);
        } else {
            res.redirect(`${process.env.FRONTEND_URL}/enter-email?sessionId=${session._id}`);
        }

    } catch (error) {
        console.error('\n--- FATAL OAUTH CALLBACK ERROR ---');
        console.error(error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        res.status(500).send('An error occurred during authentication. Please check the server logs.');
    }
});

module.exports = router;
