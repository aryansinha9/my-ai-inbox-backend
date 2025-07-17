// backend/models/User.js

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatarUrl: { type: String },
    
    business: {
        name: String, 
        googleSheetId: { type: String, required: true },
        instagramPageId: { type: String, required: true, unique: true },
        instagramPageAccessToken: { type: String, required: true },
        plan: { type: String, enum: ['basic', 'pro', 'enterprise'], default: 'basic' },
        facebookUserId: String,
        platformAiStatus: {
            instagram: { type: Boolean, default: true },
            facebook: { type: Boolean, default: true },
        },
        
        // --- UPDATED SECTION ---
        bookingIntegration: {
            provider: { 
                type: String, 
                enum: ['setmore', 'square', 'none'], // We will support these two for now
                default: 'none' 
            },
            // Securely stores the API key/token for the client's chosen service
            apiKey: { type: String } 
        }
        // --- END OF UPDATED SECTION ---
    },

    termsAgreement: {
        version: { type: String, default: '1.0.0' },
        agreedAt: { type: Date, required: true }
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
