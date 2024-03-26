import {
    parseEventRedeemExecution,
} from "./event-parsers.js";

export class EventListener {
    static eventListeners = new Map();

    pendingIssueEvents = [];
    pendingRedeemEvents = [];

    api = undefined;

    constructor(api) {
        this.api = api;
        this.initEventSubscriber();
    }

    static getEventListener(api) {
        if (!this.eventListeners.has(api)) {
            const newListener = new EventListener(api);
            this.eventListeners.set(api, newListener);
        }
        return this.eventListeners.get(api);
    }

    async initEventSubscriber() {
        this.api.query.system.events((events) => {
            events.forEach((event) => {
                this.processEvents(event, this.pendingIssueEvents);
                this.processEvents(event, this.pendingRedeemEvents);
            });
        });
    }

    waitForRedeemExecuteEvent(redeemId, maxWaitingTimeMs,) {
        let filter = (event) => {
            if (event.event.section === "redeem" && event.event.method === "ExecuteRedeem") {
                let eventParsed = parseEventRedeemExecution(event);
                if (eventParsed.redeemId == redeemId) {
                    return eventParsed;
                }
            }
            return null;
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Max waiting time exceeded for Redeem Execution", redeemId, "Redeem Execution",),);
            }, maxWaitingTimeMs);

            this.pendingRedeemEvents.push({
                filter, resolve: (event) => {
                    clearTimeout(timeout);
                    resolve(event);
                },
            });
        });
    }

    processEvents(event, pendingEvents) {
        pendingEvents.forEach((pendingEvent, index) => {
            const matchedEvent = pendingEvent.filter(event);

            if (matchedEvent) {
                pendingEvent.resolve(matchedEvent);
                pendingEvents.splice(index, 1);
            }
        });
    }
}
