const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatarUrl: { type: String },
    // In a real app, you'd store a hashed password, not the email again.
    // password: { type: String, required: true },

    // Business-specific information linked to the user
    business: {
        // The client's business name
        name: String, 

        // The unique ID of the Google Sheet containing their business info
        googleSheetId: { 
            type: String,
            // We will collect this during an onboarding step
            required: true 
        },

        // The unique ID of their Instagram Business Account Page
        instagramPageId: { 
            type: String, 
            required: true, 
            unique: true // Only one client can be linked to one Instagram page
        },
        
        // Their unique, permanent Facebook Page Access Token
        // NOTE: A User Access Token is temporary. A Page Access Token is what we need.
        instagramPageAccessToken: { 
            type: String, 
            required: true 
        },

        plan: {
        type: String,
        enum: ['basic', 'pro', 'enterprise'],
        default: 'basic'
        },

        // The unique ID of their Facebook account (for reference)
        facebookUserId: String,

        // Global AI toggle status for each platform
        platformAiStatus: {
            instagram: { type: Boolean, default: true },
            facebook: { type: Boolean, default: true },
        },


    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);