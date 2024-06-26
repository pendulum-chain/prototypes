import {Keyring} from "@polkadot/api";
import {Asset} from "stellar-sdk";
import {stellarHexToPublic} from "./convert.js";
import {parseEventRedeemRequest} from "./event-parsers.js";

export function extractAssetFromWrapped(wrapped,) {
    if (wrapped.Stellar === "StellarNative") {
        return Asset.native();
    } else if ("AlphaNum4" in wrapped.Stellar) {
        // Check if we need to convert the issuer to a public key
        const issuer = wrapped.Stellar.AlphaNum4.issuer.startsWith("0x") ? stellarHexToPublic(wrapped.Stellar.AlphaNum4.issuer) : wrapped.Stellar.AlphaNum4.issuer;

        return new Asset(trimCode(wrapped.Stellar.AlphaNum4.code), issuer);
    } else if ("AlphaNum12" in wrapped.Stellar) {
        // Check if we need to convert the issuer to a public key
        const issuer = wrapped.Stellar.AlphaNum12.issuer.startsWith("0x") ? stellarHexToPublic(wrapped.Stellar.AlphaNum12.issuer) : wrapped.Stellar.AlphaNum12.issuer;

        return new Asset(trimCode(wrapped.Stellar.AlphaNum12.code), issuer);
    } else {
        throw new Error("Invalid Stellar type in wrapped");
    }
}

// Take an asset code that is either hex or ascii and trim it from 0 bytes
function trimCode(code) {
    if (code.startsWith("0x")) {
        // Filter out the null bytes
        const filtered = code.replace(/00/g, "");
        return Buffer.from(filtered.slice(2), "hex").toString().trim();
    } else {
        // Convert to hex string
        const hex = Buffer.from(code).toString("hex");
        // Filter out the null bytes
        const filtered = hex.replace(/00/g, "");
        // Convert back to ascii
        return Buffer.from(filtered, "hex").toString().trim();
    }
}

export function prettyPrintVaultId(vaultId) {
    const wrappedAssetInfo = extractAssetFromWrapped(vaultId.currencies.wrapped);

    return `${vaultId.accountId} { XCM(${vaultId.currencies.collateral.XCM}) - ${prettyPrintAssetInfo(wrappedAssetInfo)} }`;
}

// We just omit the issuer here for readability
function prettyPrintAssetInfo(assetInfo) {
    // Decode hex code to ascii if it starts with 0x
    if (assetInfo.code.startsWith("0x")) {
        return trimCode(assetInfo.code);
    }

    return assetInfo.code;
}

export class VaultService {
    vaultId = undefined;
    api = undefined

    constructor(vaultId, api) {
        this.vaultId = vaultId;
        // Potentially validate the vault given the network,
        // validate the wrapped asset consistency, etc
        this.api = api;
    }

    async requestRedeem(uri, amount, stellarPkBytes) {
        return new Promise(async (resolve, reject) => {
            const keyring = new Keyring({type: "sr25519"});
            keyring.setSS58Format(this.api.ss58Format);
            const origin = keyring.addFromUri(uri);

            const release = await this.api.mutex.lock(origin.address);
            const nonce = await this.api.api.rpc.system.accountNextIndex(origin.publicKey,);
            await this.api.api.tx.redeem
                .requestRedeem(amount, stellarPkBytes, this.vaultId)
                .signAndSend(origin, {nonce}, (submissionResult) => {
                    const {status, events, dispatchError} = submissionResult;

                    if (status.isFinalized) {
                        console.log(`Requested redeem of ${amount} for vault ${prettyPrintVaultId(this.vaultId,)} with status ${status.type}`,);

                        // Try to find a 'system.ExtrinsicFailed' event
                        const systemExtrinsicFailedEvent = events.find((record) => {
                            return (record.event.section === "system" && record.event.method === "ExtrinsicFailed");
                        });

                        if (dispatchError) {
                            return reject(this.handleDispatchError(dispatchError, systemExtrinsicFailedEvent, "Redeem Request",),);
                        }
                        //find all redeem request events and filter the one that matches the requester
                        let redeemEvents = events.filter((event) => {
                            return (event.event.section.toLowerCase() === "redeem" && event.event.method.toLowerCase() === "requestredeem");
                        });

                        let event = redeemEvents
                            .map((event) => parseEventRedeemRequest(event))
                            .filter((event) => {
                                return event.redeemer === origin.address;
                            });

                        if (event.length == 0) {
                            reject(new Error(`No redeem event found for account ${origin.address}`),);
                        }
                        //we should only find one event corresponding to the issue request
                        if (event.length != 1) {
                            reject(new Error("Inconsistent amount of redeem request events for account",),);
                        }
                        resolve(event[0]);
                    }
                })
                .catch((error) => {
                    reject(new Error(`Failed to request redeem: ${error}`));
                })
                .finally(() => release());
        });
    }

    // We first check if dispatchError is of type "module",
    // If not we either return ExtrinsicFailedError or Unknown dispatch error
    handleDispatchError(dispatchError, systemExtrinsicFailedEvent, extrinsicCalled) {
        if (dispatchError?.isModule) {
            const decoded = this.api.api.registry.findMetaError(dispatchError.asModule);
            const {docs, name, section, method} = decoded;

            return new Error(`Dispatch error: ${section}.${method}:: ${name}`);
        } else if (systemExtrinsicFailedEvent) {
            const eventName = systemExtrinsicFailedEvent?.event.data && systemExtrinsicFailedEvent?.event.data.length > 0 ? systemExtrinsicFailedEvent?.event.data[0].toString() : "Unknown";

            const {
                phase, event: {data, method, section}
            } = systemExtrinsicFailedEvent;
            console.log(`Extrinsic failed in phase ${phase.toString()} with ${section}.${method}:: ${eventName}`);

            return new Error(`Failed to dispatch ${extrinsicCalled}`);
        } else {
            console.log("Encountered some other error: ", dispatchError?.toString(), JSON.stringify(dispatchError),);
            return new Error(`Unknown error during ${extrinsicCalled}`);
        }
    }
}
