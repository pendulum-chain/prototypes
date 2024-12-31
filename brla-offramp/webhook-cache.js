const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

const events = [];
const MAX_EVENTS = 10; 


app.post('*', (req, res) => {
    events.push(req.body);
    if (events.length > MAX_EVENTS) {
        events.shift(); 
    }
    console.log('Event received:', req.body);
    res.status(200).send('Event recorded');
});

app.get('/events', (req, res) => {
    res.json(events);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
