// backend/routes/auth.js

const express = require('express');
const axios = require('axios');
const router = express.Router();
const User = require('../models/User');
const OnboardingSession = require('../models/OnboardingSession');

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = `${process.env.SERVER_URL}/api/auth/instagram/callback`;

// --- HELPER FUNCTIONS ---

async function getLongLivedUserToken(code) {
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token`;
    const tokenParams = {
        client_id: FB_APP_ID,
        redirect_uri: REDIRECT_URI,
        client_secret: FB_APP_SECRET,
        code
    };
    const tokenResponse = await axios.get(tokenUrl, { params: tokenParams });
    const shortLivedToken = tokenResponse.data.access_token;

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

async function getUserProfile(accessToken) {
    const profileUrl = `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`;
    const response = await axios.get(profileUrl);
    return response.data;
}

// --- OAUTH START ROUTE ---
router.get('/instagram', (req, res) => {
    console.log('[AUTH_START] Business integration OAuth flow initiated.');
    
    // The business_management scope is crucial for establishing the integration.
    const scopes = [
        'business_management',
        'instagram_basic',
        'instagram_manage_messages',
        'pages_show_list',
        'pages_manage_metadata',
        'email',
        'public_profile',
        'pages_messaging'
    ];
    
    // extras.setup triggers the correct business integration flow in the Meta UI.
    const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` +
                    `client_id=${FB_APP_ID}&` +
                    `redirect_uri=${REDIRECT_URI}&` +
                    `scope=${scopes.join(',')}&` +
                    `extras={"setup":{"channel":"IG_SC_INBOX"}}`;
    
    console.log('[AUTH_START] Redirecting user to Meta for business integration.');
    res.redirect(authUrl);
});

// --- OAUTH CALLBACK WITH TOKEN VALIDATION (UPDATED VERSION) ---
router.get('/instagram/callback', async (req, res) => {
    const { code } = req.query;
    console.log('[AUTH_CALLBACK] OAuth Callback Started.');

    if (!code) return res.status(400).send('Error: No authorization code provided.');

    try {
        const userAccessToken = await getLongLivedUserToken(code);
        
        // Token validation remains the same...
        console.log('[AUTH_CALLBACK] Validating token with debug_token endpoint...');
        const debugUrl = `https://graph.facebook.com/debug_token?input_token=${userAccessToken}&access_token=${FB_APP_ID}|${FB_APP_SECRET}`;
        const tokenDebugResponse = await axios.get(debugUrl);
        const grantedScopes = tokenDebugResponse.data.data.scopes;
        if (!grantedScopes.includes('pages_messaging')) {
            console.error('[AUTH_CALLBACK] FATAL: pages_messaging permission was not granted.');
            return res.status(403).send('The required permissions to manage messages were not granted.');
        }
        console.log('[AUTH_CALLBACK] Token validation successful.');

        const profile = await getUserProfile(userAccessToken);
        const hasEmail = profile.email && profile.email.length > 0;

        // --- START OF THE FIX ---

        // 1. First, get the pages and their linked Instagram accounts WITHOUT asking for the owner.
        const initialPagesUrl = `https://graph.facebook.com/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&access_token=${userAccessToken}`;
        const pagesResponse = await axios.get(initialPagesUrl);
        const userPagesWithIg = pagesResponse.data.data.filter(p => p.instagram_business_account);

        if (userPagesWithIg.length === 0) return res.status(400).send("No Instagram Business Accounts found linked to your Facebook Pages.");

        // 2. Now, for each of those pages, make a second call to get its business owner.
        // This is more resilient and won't fail if a page has no owner.
        const pagesWithBusinessDetails = await Promise.all(
            userPagesWithIg.map(async (page) => {
                try {
                    const ownerUrl = `https://graph.facebook.com/v19.0/${page.id}?fields=owner_business&access_token=${userAccessToken}`;
                    const ownerResponse = await axios.get(ownerUrl);
                    
                    // Combine the original page data with the new business ID
                    return {
                        ...page,
                        businessId: ownerResponse.data.owner_business ? ownerResponse.data.owner_business.id : null,
                    };
                } catch (error) {
                    console.warn(`[AUTH_CALLBACK] Could not fetch owner for page ${page.id}. It might be a classic page. Skipping.`);
                    return null; // Return null for pages that fail the lookup
                }
            })
        );
        
        // 3. Filter out any pages that we couldn't get a business owner for.
        const validPages = pagesWithBusinessDetails.filter(p => p && p.businessId);
        
        if (validPages.length === 0) {
            return res.status(400).send("Could not find any Instagram accounts that are properly managed by a Meta Business account. Please check your page setup in Meta Business Suite.");
        }

        // --- END OF THE FIX ---

        const session = await OnboardingSession.findOneAndUpdate(
            { facebookUserId: profile.id },
            {
                name: profile.name,
                email: profile.email,
                avatarUrl: profile.picture.data.url,
                pages: validPages.map(p => ({ // Use the filtered 'validPages' list
                    id: p.instagram_business_account.id,
                    name: p.instagram_business_account.username,
                    access_token: p.access_token,
                    avatar: p.instagram_business_account.profile_picture_url,
                    businessId: p.businessId // This will now be correctly populated
                }))
            },
            { upsert: true, new: true }
        );

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
