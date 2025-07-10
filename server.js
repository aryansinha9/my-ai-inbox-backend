// backend/server.js

// 1. Imports and Initializations
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const apiRoutes = require('./routes/api');
const webhookRoutes =require('./routes/webhook');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 4000;

// 2. Connect to Database
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Successfully connected to MongoDB."))
    .catch(err => {
        console.error("Database connection error:", err);
        process.exit(1);
    });

// 3. Middleware
// --- THIS IS THE CORRECTED SECTION ---

// Define the list of trusted frontend origins.
// We use process.env.FRONTEND_URL to get the live Vercel URL dynamically.
const allowedOrigins = [
    'http://localhost:5173', // For local development
    process.env.FRONTEND_URL   // For the deployed Vercel site
];

const corsOptions = {
    origin: function (origin, callback) {
        // If the origin is in our trusted list (or if it's a server-to-server request with no origin), allow it.
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
};

// **CRITICAL FIX:** Pass the 'corsOptions' object into the cors middleware.
app.use(cors(corsOptions));

// This middleware is for parsing incoming request bodies.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- END OF CORRECTION ---


// 4. Routes
// The API for our React frontend
app.use('/api', apiRoutes);
// The Webhook for Meta/Instagram
app.use('/webhook', webhookRoutes);
// The Authentication flow for Meta
app.use('/api/auth', authRoutes);

// Simple root route for Render's Health Check
app.get('/', (req, res) => {
    res.send('CEO Backend is running!');
});

// 5. Start the Server
app.listen(PORT, () => {
    // The console log now correctly uses the PORT variable.
    console.log(`CEO Backend server is listening on port ${PORT}`);
});
