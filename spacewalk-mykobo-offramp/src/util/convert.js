import {StrKey} from "stellar-sdk";
import BigNumber from "big.js";

export function stellarHexToPublic(hexString) {
    return StrKey.encodeEd25519PublicKey(hexToBuffer(hexString));
}

export function hexToBuffer(hexString) {
    if (hexString.length % 2 !== 0) {
        throw new Error("The provided hex string has an odd length. It must have an even length.",);
    }
    return Buffer.from(hexString.split("0x")[1], "hex");
}

export function hexToString(hexString) {
    let asBuffer = hexToBuffer(hexString);
    return asBuffer.toString("utf8");
}

// These are the decimals used for the native currency on the Amplitude network
export const ChainDecimals = 12;
// These are the decimals used by the Stellar network
// We actually up-scale the amounts on Stellar now to match the expected decimals of the other tokens.
export const StellarDecimals = ChainDecimals;

// Converts a native Stellar value to a decimal value (eg 1000000000 -> 0.1)
export const nativeStellarToDecimal = (value) => {
    const bigIntValue = new BigNumber(value);
    const divisor = new BigNumber(10).pow(StellarDecimals);

    return bigIntValue.div(divisor);
};

// Converts a decimal value to the native Stellar value (eg 0.1 -> 1000000000)
export const decimalToStellarNative = (value) => {
    let bigIntValue;
    try {
        bigIntValue = new BigNumber(value);
    } catch (error) {
        bigIntValue = new BigNumber(0);
    }
    const multiplier = new BigNumber(10).pow(StellarDecimals);
    return bigIntValue.times(multiplier);
};
