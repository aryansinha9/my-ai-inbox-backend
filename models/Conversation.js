const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    // Link to the business owner
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['instagram', 'facebook'], required: true },
    // The ID of the end-user (customer) on the platform
    contactId: { type: String, required: true },
    contactName: { type: String },
    contactAvatarUrl: { type: String },
    lastMessage: { type: String },
    lastMessageTimestamp: { type: Date },
    isAiEnabled: { type: Boolean, default: true },
    deepLink: { type: String },
}, { timestamps: true });

// Create a compound index to quickly find conversations
conversationSchema.index({ userId: 1, platform: 1, contactId: 1 }, { unique: true });

module.exports = mongoose.model('Conversation', conversationSchema);