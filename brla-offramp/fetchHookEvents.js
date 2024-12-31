const axios = require('axios');

const TIMEOUT_MS = 120000;


async function fetchEvents(user_id, api_url) {
    const startTime = Date.now();

    while (Date.now() - startTime < TIMEOUT_MS) {
        try {
            console.log(api_url)
            const response = await axios.get(api_url);

            const events = response.data;

            // Filter events by userId
            const filteredEvents = events.filter(event => event.userId === user_id);

            // Process filtered events
            for (const event of filteredEvents) {
                // Check for success or failure
                if (event.data.status === 'SUCCESS' && event.data.kycStatus === 'VERIFIED') {
                    console.log(`Received event: ${JSON.stringify(event)}`);
                    return event;
                } else if (event.data.status === 'FAILED' && event.data.kycStatus === 'REJECTED') {
                    console.log(`Received event: ${JSON.stringify(event)}`);
                    return event;
                }
            }
        } catch (error) {
            console.error('Error fetching events:', error.message);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
    }


    throw new Error('Timeout reached without receiving success or failure event.');

}

exports.fetchEvents = fetchEvents;