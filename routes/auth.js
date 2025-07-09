// backend/routes/auth.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const User = require('../models/User');

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
    const tokenParams = { client_id: FB_APP_ID, redirect_uri: REDIRECT_URI, client_secret: FB_APP_SECRET, code };
    const tokenResponse = await axios.get(tokenUrl, { params: tokenParams });
    const shortLivedToken = tokenResponse.data.access_token;

    // Exchange short-lived for long-lived token
    const longLivedUrl = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const longLivedParams = { grant_type: 'fb_exchange_token', client_id: FB_APP_ID, client_secret: FB_APP_SECRET, fb_exchange_token: shortLivedToken };
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

// Route #2: The upgraded multi-tenant callback
router.get('/instagram/callback', async (req, res) => {
    const { code } = req.query;
    console.log('[DEBUG] --- OAuth Callback Started ---');

    if (!code) {
        return res.status(400).send('Error: No authorization code provided by Facebook.');
    }

    try {
        // Step 1: Get a long-lived USER access token
        console.log('[DEBUG] Step 1: Getting long-lived USER token...');
        const userAccessToken = await getLongLivedUserToken(code);
        console.log('[DEBUG] Step 1 SUCCESS: Got long-lived USER token.');

        // Step 2: Get the user's Pages to find the permanent PAGE Access Token
        console.log('[DEBUG] Step 2: Getting user\'s managed pages...');
        const pagesUrl = `https://graph.facebook.com/me/accounts?access_token=${userAccessToken}`;
        const pagesResponse = await axios.get(pagesUrl);
        
        // In a real app, you would let the user choose which page. For now, we take the first.
        const firstPage = pagesResponse.data.data[0];
        if (!firstPage) {
            return res.status(400).send("Could not find a Facebook Page. Please ensure you granted permission for the correct page during login.");
        }
        
        const pageId = firstPage.id;
        const pageAccessToken = firstPage.access_token; // This is the permanent token we need!
        console.log(`[DEBUG] Step 2 SUCCESS: Found Page ID: ${pageId}`);

        // Step 3: Get the user's profile info
        console.log('[DEBUG] Step 3: Getting user profile...');
        const profile = await getUserProfile(userAccessToken);
        console.log(`[DEBUG] Step 3 SUCCESS: Got profile for user (Email: ${profile.email})`);

        // Step 4: Find or Create the user in our database
        console.log(`[DEBUG] Step 4: Finding/Creating user for Facebook ID ${profile.id}`);
        const user = await User.findOneAndUpdate(
            { 'business.facebookUserId': profile.id },
            { 
              name: profile.name,
              email: profile.email,
              avatarUrl: profile.picture.data.url,
              'business.instagramPageId': pageId,
              'business.instagramPageAccessToken': pageAccessToken,
              // IMPORTANT: In a real app, this would be collected in an onboarding step.
              'business.googleSheetId': 'YOUR_DEFAULT_GOOGLE_SHEET_ID_HERE', 
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        console.log(`[DEBUG] Step 4 SUCCESS: Database operation complete for user ID: ${user._id}`);
        
        // Step 5: Redirect back to frontend
        console.log(`[DEBUG] --- OAuth Callback Complete. Redirecting to frontend with userId: ${user._id} ---`);
        res.redirect(`${process.env.FRONTEND_URL}/?userId=${user._id.toString()}`);

    } catch (error) {
        console.error('\n--- FATAL OAUTH ERROR ---');
        if (error.response) {
            console.error('[DEBUG] Axios Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('[DEBUG] Non-Axios Error:', error.message);
        }
        res.status(500).send('An error occurred during authentication. Check the backend server logs.');
    }
});

module.exports = router;