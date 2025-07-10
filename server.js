// backend/server.js

// 1. Imports and Initializations
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const apiRoutes = require('./routes/api');
const webhookRoutes = require('./routes/webhook');
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

// --- The New, Robust Middleware Configuration ---

// Define the list of trusted frontend origins. Using the env variable is best practice.
const allowedOrigins = [
    'http://localhost:5173',
    process.env.FRONTEND_URL
]
.map(url => url ? url.trim() : url) // Trim whitespace from URLs
.filter(url => url); // Filter out any undefined, null, or empty strings


const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl) and requests from our trusted list.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        // Also allow Vercel preview URLs, which have a dynamic hash.
        if (origin.startsWith('https://my-ai-inbox-frontend-') && origin.endsWith('.vercel.app')) {
            return callback(null, true);
        }
        
        // If the origin is not in our list, reject it.
        console.log(`[CORS] Blocked request from unauthorized origin: ${origin}`);
        return callback(new Error('This origin is not allowed by CORS.'));
    },
    credentials: true
};

// **CRITICAL DEBUGGING MIDDLEWARE:** This will log every single incoming request.
app.use((req, res, next) => {
    console.log(`[REQUEST] Method: ${req.method} | Path: ${req.originalUrl} | Origin: ${req.headers.origin || 'None'}`);
    next();
});

// Handle preflight requests across all routes
app.options('*', cors(corsOptions));

// Apply CORS middleware for all other requests
app.use(cors(corsOptions));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- End of Middleware Configuration ---


// 4. Routes
//app.use('/api', apiRoutes);
//app.use('/webhook', webhookRoutes);
//app.use('/api/auth', authRoutes);

// Simple root route for Render's Health Check
app.get('/', (req, res) => {
    res.send('CEO Backend is running!');
});

// 5. Start the Server
app.listen(PORT, () => {
    console.log(`CEO Backend server is listening on port ${PORT}`);
    console.log(`Allowed CORS origins for direct match: ${allowedOrigins.join(', ')}`);
});
