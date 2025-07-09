// backend/server.js

// 1. Imports and Initializations
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const apiRoutes = require('./routes/api');
const webhookRoutes = require('./routes/webhook');
const authRoutes = require('./routes/auth'); // <--- ADD THIS LINE

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
const corsOptions = {
    origin: ['http://localhost:5173', 'https://my-ai-inbox-frontend-ly025s8ns-ananta-systems-projects.vercel.app/'], // Your frontend's URL
    optionsSuccessStatus: 200 // For older browsers
};
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Routes
// The API for our React frontend
app.use('/api', apiRoutes);
// The Webhook for Meta/Instagram
app.use('/webhook', webhookRoutes);
// The Authentication flow for Meta
app.use('/api/auth', authRoutes); // <--- AND ADD THIS LINE

// Simple root route to confirm server is running
app.get('/', (req, res) => {
    res.send('CEO Backend is running!');
});

// 5. Start the Server
app.listen(PORT, () => {
    console.log(`CEO Backend server is listening on http://localhost:${PORT}`);
});