// backend/server.js - MINIMAL DEBUG VERSION
require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 4000;

console.log("--- Starting Minimal Server ---");

app.get('/', (req, res) => {
    res.send('Minimal server is running!');
});

app.listen(PORT, () => {
    console.log(`Minimal server is listening on port ${PORT}`);
});
