import { ASSET_CODE, ASSET_ISSUER } from "./index";

export default async function finalize({
  amountString,
  ephemeralAccountId,
  horizonServer,
  offrampinTransaction,
  mergeAccountTransaction,
  pendulumSecret,
}) {
  await executeSpacewalkRedeem(ephemeralAccountId, amountString, pendulumSecret);

  console.log("Submit offramping transaction");
  try {
    await horizonServer.submitTransaction(offrampinTransaction);
  } catch (error) {
    console.log(error.response.data.extras);
  }

  console.log("Submit cleanup transaction");
  try {
    await horizonServer.submitTransaction(mergeAccountTransaction);
  } catch (error) {
    console.log(error.response.data.extras);
  }

  console.log("All complete");
}

async function executeSpacewalkRedeem(stellarTargetAccountId, amountString, pendulumSecret) {
  // redeem amountString (amount is a string with 7 decimals) from the Pendulum account
  // given by pendulumSecret for asset defined by ASSET_CODE, ASSET_ISSUER to the stellar account
  // given by stellarTargetAccountId

  // the amountString is the target amount after all subtraction of Spacewalk fees
  // this amount must be ultimately transferred to the stellarTargetAccountId

  // when this function returns the Stellar redeem transaction must already be completed so that
  // the assets are already on the stellarTargetAccountId
  console.log("Execute Spacewalk redeem");
}
