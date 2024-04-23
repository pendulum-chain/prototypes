import prompts from "prompts";
import { Keypair, Transaction, TransactionBuilder, Horizon, Networks, Operation, Asset, Memo } from "stellar-sdk";
import open from "open";

import finalize from "./finalize.js";

const NETWORK_PASSPHRASE = Networks.PUBLIC;
const HORIZON_URL = "https://horizon.stellar.org";
const BASE_FEE = "1000000";

const TOKEN_CONFIG = {
  brl: {
    tomlFileUrl: "https://ntokens.com/.well-known/stellar.toml",
    assetCode: "BRL",
    assetIssuer: "GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP",
    vaultAccountId: "6g7fKQQZ9VfbBTQSaKBcATV4psApFra5EDwKLARFZCCVnSWS",
  },
  eurc: {
    tomlFileUrl: "https://mykobo.co/.well-known/stellar.toml",
    assetCode: "EURC",
    assetIssuer: "GAQRF3UGHBT6JYQZ7YSUYCIYWAF4T2SAA5237Q5LIQYJOHHFAWDXZ7NM",
    vaultAccountId: "6bsD97dS8ZyomMmp1DLCnCtx25oABtf19dypQKdZe6FBQXSm",
  },
};

async function getConfig() {
  const token = process.argv[2];
  const tokenConfig = TOKEN_CONFIG[token];
  if (tokenConfig === undefined) {
    console.error(
      "ERROR: Please specify either one of the following tokens as an argument:",
      Object.keys(TOKEN_CONFIG)
        .map((token) => `"${token}"`)
        .join(", ")
    );
    process.exit(1);
  }

  const stellarFundingSecret = await prompts.prompts.password({
    type: "password",
    message: `Enter the secret key of the Stellar account that will fund the temporary account.`,
  });

  const pendulumSecret = await prompts.prompts.password({
    type: "password",
    message: `Enter the secret seed for your Pendulum account: `,
  });

  return {
    pendulumSecret,
    stellarFundingSecret,
    tokenConfig,
  };
}

async function main() {
  const config = await getConfig();
  const { tokenConfig } = config;

  console.log("Fetch anchor information");
  const tomlFile = await fetch(tokenConfig.tomlFileUrl);
  if (tomlFile.status !== 200) {
    throw new Error(`Failed to fetch TOML file: ${tomlFile.statusText}`);
  }

  const tomlFileContent = (await tomlFile.text()).split("\n");
  const findValueInToml = (key) => {
    for (const line of tomlFileContent) {
      const regexp = new RegExp(`^\\s*${key}\\s*=\\s*"(.*)"\\s*$`);
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
  const sep24Result = await sep24(sep10Token, sep24Url, tokenConfig);
  console.log(`SEP-24 completed. Offramp details: ${JSON.stringify(sep24Result)}`);

  const horizonServer = new Horizon.Server(HORIZON_URL);
  await setupStellarAccount(config.stellarFundingSecret, ephemeralKeys, horizonServer, tokenConfig);

  const ephemeralAccountId = ephemeralKeys.publicKey();
  const ephemeralAccount = await horizonServer.loadAccount(ephemeralAccountId);
  const offrampingTransaction = await createOfframpTransaction(
    sep24Result,
    ephemeralAccount,
    ephemeralKeys,
    tokenConfig
  );
  const mergeAccountTransaction = await createAccountMergeTransaction(
    config.stellarFundingSecret,
    ephemeralAccount,
    ephemeralKeys,
    tokenConfig
  );

  await finalize({
    amountString: sep24Result.amount,
    ephemeralAccountId,
    fundingSecret: config.stellarFundingSecret,
    horizonServer,
    offrampingTransaction,
    mergeAccountTransaction,
    pendulumSecret: config.pendulumSecret,
    tokenConfig,
  });

  process.exit();
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

async function sep24(token, sep24Url, tokenConfig) {
  console.log("Initiate SEP-24");

  const sep24Params = new URLSearchParams({
    asset_code: tokenConfig.assetCode,
  });

  const fetchUrl = `${sep24Url}/transactions/withdraw/interactive`;
  const parameters = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
    body: sep24Params.toString(),
  };

  const sep24Response = await fetch(fetchUrl, parameters);
  if (sep24Response.status !== 200) {
    throw new Error(
      `Failed to initiate SEP-24: ${sep24Response.statusText}, ${fetchUrl}, ${JSON.stringify(parameters)}`
    );
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

  console.log("SEP-24 parameters received");
  return {
    amount: status.amount_in,
    memo: status.withdraw_memo,
    memoType: status.withdraw_memo_type,
    offrampingAccount: status.withdraw_anchor_account,
  };
}

async function setupStellarAccount(fundingSecret, ephemeralKeys, horizonServer, tokenConfig) {
  console.log("Setup Stellar ephemeral account");

  const fundingAccountKeypair = Keypair.fromSecret(fundingSecret);
  const fundingAccountId = fundingAccountKeypair.publicKey();
  const fundingAccount = await horizonServer.loadAccount(fundingAccountId);

  const ephemeralAccountId = ephemeralKeys.publicKey();

  // add a setOption oeration in order to make this a 2-of-2 multisig account where the
  // funding account is a cosigner
  const createAccountTransaction = new TransactionBuilder(fundingAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.createAccount({
        destination: ephemeralAccountId,
        startingBalance: "2.5",
      })
    )
    .addOperation(
      Operation.setOptions({
        source: ephemeralAccountId,
        signer: { ed25519PublicKey: fundingAccountId, weight: 1 },
        lowThreshold: 2,
        medThreshold: 2,
        highThreshold: 2,
      })
    )
    .setTimeout(30)
    .build();

  createAccountTransaction.sign(fundingAccountKeypair);
  createAccountTransaction.sign(ephemeralKeys);

  try {
    await horizonServer.submitTransaction(createAccountTransaction);
  } catch (error) {
    console.error("Could not submit the create account transaction");
    console.error(error.response.data.extras);
  }

  const ephemeralAccount = await horizonServer.loadAccount(ephemeralAccountId);
  const changeTrustTransaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(tokenConfig.assetCode, tokenConfig.assetIssuer),
      })
    )
    .setTimeout(30)
    .build();

  changeTrustTransaction.sign(ephemeralKeys);
  changeTrustTransaction.sign(fundingAccountKeypair);
  try {
    await horizonServer.submitTransaction(changeTrustTransaction);
  } catch (error) {
    console.error("Could not submit the change trust transaction");
    console.error(error.response.data.extras);
  }
}

async function createOfframpTransaction(sep24Result, ephemeralAccount, ephemeralKeys, tokenConfig) {
  // this operation would run completely in the browser
  // that is where the signature of the ephemeral account is added
  const { amount, memo, memoType, offrampingAccount } = sep24Result;

  let transactionMemo;
  switch (memoType) {
    case "text":
      transactionMemo = Memo.text(memo);
      break;

    case "hash":
      transactionMemo = Memo.hash(Buffer.from(memo, "base64"));
      break;

    default:
      throw new Error(`Unexpected offramp memo type: ${memoType}`);
  }

  const transaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        amount,
        asset: new Asset(tokenConfig.assetCode, tokenConfig.assetIssuer),
        destination: offrampingAccount,
      })
    )
    .addMemo(transactionMemo)
    .setTimeout(7 * 24 * 3600)
    .build();
  transaction.sign(ephemeralKeys);

  return transaction;
}

async function createAccountMergeTransaction(fundingSecret, ephemeralAccount, ephemeralKeys, tokenConfig) {
  // this operation would run completely in the browser
  // that is where the signature of the ephemeral account is added
  const transaction = new TransactionBuilder(ephemeralAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(tokenConfig.assetCode, tokenConfig.assetIssuer),
        limit: "0",
      })
    )
    .addOperation(
      Operation.accountMerge({
        destination: Keypair.fromSecret(fundingSecret).publicKey(),
      })
    )
    .setTimeout(7 * 24 * 3600)
    .build();
  transaction.sign(ephemeralKeys);

  return transaction;
}

main().then(console.log, console.error);
