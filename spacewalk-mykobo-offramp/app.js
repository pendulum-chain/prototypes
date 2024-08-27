document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.getElementById('startButton');
    const inputOne = document.getElementById('inputOne');
    const inputTwo = document.getElementById('inputTwo');
    const eventsContainer = document.getElementById('eventsContainer');

    startButton.addEventListener('click', () => {
        const eventData = {
            inputOne: inputOne.value,
            inputTwo: inputTwo.value
        };
        addEvent(eventData);
    });

    function addEvent(eventData) {
        const eventBox = document.createElement('div');
        eventBox.classList.add('eventBox');
        eventBox.innerHTML = `<p>Event: ${eventData.inputOne} and ${eventData.inputTwo}</p>`;
        eventsContainer.appendChild(eventBox);
    }
});


