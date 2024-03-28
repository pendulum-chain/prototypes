## Offramping prototype

This prototype demonstrates an offramping flow of EURC tokens from Pendulum to Stellar (via Spacewalk) and then to a bank account.

Run this prototype by executing

```
node src/index.js
```

At the start you have to enter two values:

- The secret key of a Stellar account that is used to fund the temporary account. This account will almost get all funds back (minus some transaction fees) at the end of the process.

- The secret seed of your Pendulum account that should execute the offramp. This secret usually consists of 12 English words.

The prototype will then guide you through some interactive flow in a browser window where you

- go through a KYC process
- enter the amount to offramp
- enter the IBAN of the target account
