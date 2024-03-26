import prompts from "prompts";
import { Keypair, Transaction, TransactionBuilder, Horizon, Networks, Operation, Asset, Memo } from "stellar-sdk";
import open from "open";
import finalize from "./finalize";

const TOML_FILE_URL = "https://mykobo.co/.well-known/stellar.toml";
export const ASSET_CODE = "EURC";
export const ASSET_ISSUER = "GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM";
const NETWORK_PASSPHRASE = Networks.PUBLIC;
const HORIZON_URL = "https://horizon.stellar.org";
const BASE_FEE = "10000";

async function getConfig() {
  const stellarFundingSecret = process.env.STELLAR_FUNDING_SECRET;
  if (!stellarFundingSecret) {
    throw new Error(
      "No STELLAR_FUNDING_SECRET environment variable found. Please set it to the secret seed of the Stellar account that will fund the ephemeral account."
    );
  }

  const pendulumSecret = await prompts.prompts.password({
    type: "password",
    message: `Enter the secret seed for your Pendulum account: `,
  });

  return {
    pendulumSecret,
    stellarFundingSecret,
  };
}

async function main() {
  const config = await getConfig();

  console.log("Fetch anchor information");
  const tomlFile = await fetch(TOML_FILE_URL);
  if (tomlFile.status !== 200) {
    throw new Error(`Failed to fetch TOML file: ${tomlFile.statusText}`);
  }

  const tomlFileContent = (await tomlFile.text()).split("\n");
  const findValueInToml = (key) => {
    for (const line of tomlFileContent) {
      const regexp = new RegExp(`^\s*${key}\s*=\s*"(.*)"\s*$`);
      if (regexp.test(line)) {
        return regexp.exec(line)[1];
      }
    }
  };

  const signingKey = findValueInToml("SIGNING_KEY");
  const webAuthEndpoint = findValueInToml("WEB_AUTH_ENDPOINT");
  const sep24Url = findValueInToml("TRANSFER_SERVER_SEP0024");

  const ephemeralKeys = Keypair.random();
  console.log(`Ephemeral secret: ${ephemeralKeys.secret()}`);

  const sep10Token = await sep10(ephemeralKeys, signingKey, webAuthEndpoint);
  const sep24Result = await sep24(sep10Token, sep24Url);
  console.log(`SEP-24 completed. Offramp details: ${JSON.stringify(sep24Result)}`);

  const horizonServer = new Horizon.Server(HORIZON_URL);
  await setupStellarAccount(config.stellarFundingSecret, ephemeralKeys, horizonServer);

  const ephemeralAccountId = ephemeralKeys.publicKey();
  const ephemeralAccount = await horizonServer.loadAccount(ephemeralAccountId);
  const offrampinTransaction = await createOfframpTransaction(sep24Result, ephemeralAccount, ephemeralKeys);
  const mergeAccountTransaction = await createAccountMergeTransaction(
    config.stellarFundingSecret,
    ephemeralAccount,
    ephemeralKeys
  );

  await finalize({
    amountString: sep24Result.amount,
    ephemeralAccountId,
    horizonServer,
    offrampinTransaction,
    mergeAccountTransaction,
    pendulumSecret: config.pendulumSecret,
  });
}

async function sep10(ephemeralKeys, signingKey, webAuthEndpoint) {
  const accountId = ephemeralKeys.publicKey();
  const urlParams = new URLSearchParams({
    account: accountId,
  });

  console.log("Initiate SEP-10");
  const challenge = await fetch(`${webAuthEndpoint}?${urlParams.toString()}`);
  if (challenge.status !== 200) {
    throw new Error(`Failed to fetch SEP-10 challenge: ${challenge.statusText}`);
  }

  const { transaction, network_passphrase } = await challenge.json();
  if (network_passphrase !== NETWORK_PASSPHRASE) {
    throw new Error(`Invalid network passphrase: ${network_passphrase}`);
  }

  const transactionSigned = new Transaction(transaction, NETWORK_PASSPHRASE);
  if (transactionSigned.source !== signingKey) {
    throw new Error(`Invalid source account: ${transactionSigned.source}`);
  }
  if (transactionSigned.sequence !== "0") {
    throw new Error(`Invalid sequence number: ${transactionSigned.sequence}`);
  }

  // More tests required, ignore for prototype

  transactionSigned.sign(ephemeralKeys);

  const jwt = await fetch(webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: transactionSigned.toXDR().toString("base64") }),
  });

  if (jwt.status !== 200) {
    throw new Error(`Failed to submit SEP-10 response: ${jwt.statusText}`);
  }

  const { token } = await jwt.json();
  console.log(`SEP-10 challenge completed.`);
  return token;
}

async function sep24(token, sep24Url) {
  console.log("Initiate SEP-24");

  const sep24Params = new URLSearchParams({
    asset_code: ASSET_CODE,
  });

  const sep24Response = await fetch(`${sep24Url}/transactions/withdraw/interactive`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
    body: sep24Params.toString(),
  });
  if (sep24Response.status !== 200) {
    throw new Error(`Failed to initiate SEP-24: ${sep24Response.statusText}`);
  }

  const { type, url, id } = await sep24Response.json();
  if (type !== "interactive_customer_info_needed") {
    throw new Error(`Unexpected SEP-24 type: ${type}`);
  }

  console.log(`SEP-24 initiated. Please complete the form at ${url}.`);
  await open(url);

  console.log("Waiting for interactive form to be completed.");
  let status;
  do {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const idParam = new URLSearchParams({ id });
    const statusResponse = await fetch(`${sep24Url}/transaction?${idParam.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (statusResponse.status !== 200) {
      throw new Error(`Failed to fetch SEP-24 status: ${statusResponse.statusText}`);
    }

    const { transaction } = await statusResponse.json();
    status = transaction;
  } while (status.status !== "pending_user_transfer_start");

  if (status.withdraw_memo_type !== "text") {
    throw new Error(`Unexpected offramp memo type: ${transaction.withdraw_memo_type}`);
  }

  console.log("SEP-24 parameters received");
  return {
    amount: status.amount_in,
    memo: status.withdraw_memo,
    offrampingAccount: status.withdraw_anchor_account,
  };
}

async function setupStellarAccount(fundingSecret, ephemeralKeys, horizonServer) {
  console.log("Setup Stellar ephemeral account");

  const fundingAccountKeypair = Keypair.fromSecret(fundingSecret);
  const fundingAccountId = fundingAccountKeypair.publicKey();
  const fundingAccount = await horizonServer.loadAccount(fundingAccountId);

  const ephemeralAccountId = ephemeralKeys.publicKey();

  const createAccountTransaction = new TransactionBuilder(fundingAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({
        destination: ephemeralAccountId,
        startingBalance: "2",
      })
    )
    .setTimeout(30)
    .build();
  createAccountTransaction.sign(fundingAccountKeypair);
  await horizonServer.submitTransaction(createAccountTransaction);

  const ephemeralAccount = await horizonServer.loadAccount(ephemeralAccountId);
  const changeTrustTransaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(ASSET_CODE, ASSET_ISSUER),
      })
    )
    .setTimeout(30)
    .build();

  changeTrustTransaction.sign(ephemeralKeys);
  await horizonServer.submitTransaction(changeTrustTransaction);
}

async function createOfframpTransaction(sep24Result, ephemeralAccount, ephemeralKeys) {
  const { amount, memo, offrampingAccount } = sep24Result;
  const transaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })

    .addOperation(
      Operation.payment({
        amount,
        asset: new Asset(ASSET_CODE, ASSET_ISSUER),
        destination: offrampingAccount,
      })
    )
    .addMemo(Memo.text(memo))
    .setTimeout(30)
    .build();
  transaction.sign(ephemeralKeys);

  return transaction;
}

async function createAccountMergeTransaction(fundingSecret, ephemeralAccount, ephemeralKeys) {
  const transaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(ASSET_CODE, ASSET_ISSUER),
        limit: "0",
      })
    )
    .addOperation(
      Operation.accountMerge({
        destination: Keypair.fromSecret(fundingSecret).publicKey(),
      })
    )
    .setTimeout(30)
    .build();
  transaction.sign(ephemeralKeys);

  return transaction;
}

main().then(console.log, console.error);
