const mongoose = require('mongoose');

const pageSchema = new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    access_token: { type: String, required: true }
});

const onboardingSessionSchema = new mongoose.Schema({
    facebookUserId: { type: String, required: true, unique: true },
    name: { type: String },
    email: { type: String },
    avatarUrl: { type: String },
    pages: [pageSchema],
    // The session will automatically expire after 15 minutes
    createdAt: { type: Date, expires: '45m', default: Date.now }
});

module.exports = mongoose.model('OnboardingSession', onboardingSessionSchema);
