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

// 3. Middleware - UPDATED CORS CONFIGURATION

// Define the list of trusted frontend origins
const allowedOrigins = [
    'http://localhost:5173', // For local development
    process.env.FRONTEND_URL, // Production Vercel site
    'https://*.vercel.app'   // Wildcard for all Vercel deployments
];

// Custom CORS origin check function
const originCheck = (origin, callback) => {
    // Allow requests with no origin (server-to-server)
    if (!origin) return callback(null, true);
    
    // Check exact matches
    if (allowedOrigins.includes(origin)) {
        return callback(null, true);
    }
    
    // Check wildcard patterns
    if (allowedOrigins.some(pattern => {
        if (pattern.startsWith('https://*.')) {
            const domain = pattern.split('*.')[1];
            return origin.endsWith(domain);
        }
        return false;
    })) {
        return callback(null, true);
    }
    
    callback(new Error(`Not allowed by CORS: ${origin}`));
};

const corsOptions = {
    origin: originCheck,
    credentials: true,
    optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Request logging middleware (for debugging)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} | Origin: ${req.headers.origin || 'none'}`);
    next();
});

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Routes
app.use('/api', apiRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/auth', authRoutes);

// Simple root route for Render's Health Check
app.get('/', (req, res) => {
    res.send('CEO Backend is running!');
});

// 5. Start the Server
app.listen(PORT, () => {
    console.log(`CEO Backend server is listening on port ${PORT}`);
    console.log(`Allowed CORS origins: ${allowedOrigins.join(', ')}`);
});
