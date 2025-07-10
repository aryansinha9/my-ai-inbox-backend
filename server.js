// backend/server.js - MINIMAL DEBUG VERSION
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose'); 
const cors = require('cors');          

const app = express();
const PORT = process.env.PORT || 4000;

// ADDED: Import webhook routes
const webhookRoutes = require('./routes/webhook');

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Successfully connected to MongoDB."))
    .catch(err => {
        console.error("DB connection error:", err);
        process.exit(1);
    });

app.use(cors());
app.use(express.json());

console.log("--- Starting Minimal Server ---");

// ADDED: Mount webhook routes
app.use('/webhook', webhookRoutes);

app.get('/', (req, res) => {
    res.send('Minimal server is running!');
});

app.listen(PORT, () => {
    console.log(`Minimal server is listening on port ${PORT}`);
});
