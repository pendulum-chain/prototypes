import {ApiPromise, WsProvider} from "@polkadot/api";

const NETWORK = "Pendulum"
const PENDULUM_WSS = "wss://rpc-pendulum.prd.pendulumchain.tech"

class ApiManager {
    apiData = {api: undefined, mutex: undefined, ss58Format: undefined};

    constructor() {
    }

    async connectApi(socketUrl) {
        const wsProvider = new WsProvider(socketUrl);
        const api = await ApiPromise.create({
            provider: wsProvider, noInitWarn: true,
        });
        const mutex = new Mutex();

        const chainProperties = await api.registry.getChainProperties();
        const ss58Format = Number(chainProperties?.get("ss58Format").toString() || 42,);

        return {api, mutex, ss58Format};
    }

    async populateApi() {
        const network = {name: NETWORK, wss: PENDULUM_WSS};

        console.log(`Connecting to node ${network.wss}...`);
        this.apiData = await this.connectApi(network.wss);
        console.log(`Connected to node ${network.wss}`);
    }

    async getApi() {
        if (!this.apiData.api) {
            await this.populateApi();
        }
        return this.apiData
    }
}

class Mutex {
    locks = new Map();

    async lock(accountId) {
        let resolveLock;
        const lockPromise = new Promise((resolve) => {
            resolveLock = resolve;
        });

        const prevLock = this.locks.get(accountId) || Promise.resolve();
        this.locks.set(accountId, prevLock.then(() => lockPromise),);

        await prevLock;

        return () => {
            resolveLock();
        };
    }
}

export {ApiManager, ApiPromise};
