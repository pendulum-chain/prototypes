import { Keypair } from "stellar-sdk";

import { ApiManager } from "./util/polkadot-api.js";
import { prettyPrintVaultId, VaultService } from "./util/spacewalk.js";
import { decimalToStellarNative } from "./util/convert.js";
import { EventListener } from "./util/event-listeners.js";

export default async function finalize({
  amountString,
  ephemeralAccountId,
  fundingSecret,
  horizonServer,
  offrampingTransaction,
  mergeAccountTransaction,
  pendulumSecret,
  tokenConfig,
}) {
  await executeSpacewalkRedeem(ephemeralAccountId, amountString, pendulumSecret, tokenConfig);

  // the following operations would happen on the backend
  // that is where the funding keypair signs the transactions
  const fundingKeypair = Keypair.fromSecret(fundingSecret);
  console.log("Submit offramping transaction");
  offrampingTransaction.sign(fundingKeypair);
  try {
    await horizonServer.submitTransaction(offrampingTransaction);
  } catch (error) {
    console.error("Could not submit the offramping transaction");
    console.error(error.response.data.extras);
  }

  console.log("Submit cleanup transaction");
  mergeAccountTransaction.sign(fundingKeypair);
  try {
    await horizonServer.submitTransaction(mergeAccountTransaction);
  } catch (error) {
    console.error("Could not submit the cleanup transaction");
    console.error(error.response.data.extras);
  }

  console.log("Offramp successfully completed");
}

// Redeem amountString (amount is a string with 7 decimals) from the Pendulum account
// given by pendulumSecret for asset defined by ASSET_CODE, ASSET_ISSUER to the stellar account
// given by stellarTargetAccountId.
// The amountString is the target amount after all subtraction of Spacewalk fees
// this amount must be ultimately transferred to the stellarTargetAccountId.
// When this function returns the Stellar redeem transaction must already be completed so that
// the assets are already on the stellarTargetAccountId.
async function executeSpacewalkRedeem(stellarTargetAccountId, amountString, pendulumSecret, tokenConfig) {
  console.log("Executing Spacewalk redeem");
  const assetIssuerRaw = `0x${Keypair.fromPublicKey(tokenConfig.assetIssuer).rawPublicKey().toString("hex")}`;

  const pendulumApi = await new ApiManager().getApi();
  // The Vault ID of the EURC vault
  let eurcVaultId = {
    accountId: tokenConfig.vaultAccountId,
    currencies: {
      collateral: { XCM: 0 },
      wrapped: { Stellar: { AlphaNum4: { code: tokenConfig.assetCode.padEnd(4, "\0"), issuer: assetIssuerRaw } } },
    },
  };
  let vaultService = new VaultService(eurcVaultId, pendulumApi);

  // We currently charge 0 fees for redeem requests on Spacewalk so the amount is the same as the requested amount
  const amountRaw = decimalToStellarNative(amountString).toString();
  // Generate raw public key for target
  let stellarTargetKeypair = Keypair.fromPublicKey(stellarTargetAccountId);
  let stellarTargetAccountIdRaw = stellarTargetKeypair.rawPublicKey();

  console.log(`Requesting redeem of ${amountRaw} tokens for vault ${prettyPrintVaultId(eurcVaultId)}`);
  let redeemRequestEvent = await vaultService.requestRedeem(pendulumSecret, amountRaw, stellarTargetAccountIdRaw);

  console.log(
    `Successfully posed redeem request ${redeemRequestEvent.redeemId} for vault ${prettyPrintVaultId(eurcVaultId)}`
  );

  const eventListener = EventListener.getEventListener(pendulumApi.api);
  // We wait for up to 5 minutes
  const maxWaitingTimeMin = 5;
  const maxWaitingTimeMs = maxWaitingTimeMin * 60 * 1000;
  console.log(`Waiting up to ${maxWaitingTimeMin} minutes for redeem execution event...`);

  const redeemEvent = await eventListener.waitForRedeemExecuteEvent(redeemRequestEvent.redeemId, maxWaitingTimeMs);

  console.log(`Successfully redeemed ${redeemEvent.amount} tokens for vault ${prettyPrintVaultId(eurcVaultId)}`);
}
