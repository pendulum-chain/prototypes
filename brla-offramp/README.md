### Testing steps


Production api: https://api.brla.digital:5567

#### Simple login, returns token
This would be the login of vortex account.

```
curl --request POST \
     --url https://api.brla.digital:5567/v1/business/login \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data '
{
  "email": "123",
  "password": "123"
}
'
```


#### Creation of subacount.
Each subacount represents a user. Each time a user wants to offramp "through" our authorized business account, 
we need to create one.

The personal information goes here.

```
curl --request POST \
     --url https://api.brla.digital:5567/v1/business/subaccounts \
     --header 'accept: application/json' \
     --header 'authorization: Bearer {auth_token}' \
     --header 'content-type: application/json' \
     --data '
{
  "taxIdType": "CPF",
  "birthDate": "asd",
  "cpf": "asd",
  "fullName": "asd",
  "address": {
    "cep": "as",
    "city": "asd",
    "state": "asd",
    "street": "ad",
    "number": "ad",
    "district": "ad",
    "complement": "ad"
  },
  "phone": "asd"
}
'

```

#### Retrieval of created subacounts

```
curl --request GET \
     --url 'https://api.brla.digital:5567/v1/business/subaccounts?taxId=asdasd' \
     --header 'accept: application/json' \
     --header 'authorization: Bearer asdasdasdasd'
```

#### Webhooks

This script here runs locally, so webhook must be listened to and cached. 
The API from BRLA has an endpoint to retreive sent hooks, but it does not hold KYC ones.

Current workaround: host a dev replit. Before starting the script, open it and ensure it is listenting. It will cache the events and 
can be queried via endpoint.

##### Example Responses

These 2 are responses after asking for a re-do of the kyc with fake data. 

```
{"subscription":"KYC","createdAt":1735213826815,"id":"6873....96e","userId":"17ce...7df","data":{"id":"23....8e5","kycStatus":"PENDING","level":1,
"status":"POSTED","taxId":"46.......29"},"acknowledged":false},

{"subscription":"KYC","
createdAt":1735213834395,"id":"8....a361","userId":"17...7df",
"data":
  {"failureReason":"birthdate does not match",
  "id":"23.....58e5",
  "kycStatus":"REJECTED",
  "level":1,"reason":"","status":"FAILED","taxId":"46....29"},"acknowledged":false}      
```

Tese other 2 are responses after creating a new subaccount (user)

```
{
  "subscription": "KYC",
  "createdAt": 1734631637352,
  "id": "00......e197",
  "userId": "17ce.....7df",
  "data": {
    "id": "ce8.....538f",
    "kycStatus": "PENDING",
    "level": 1,
    "status": "POSTED",
    "taxId": "46.....9"
  },
  "acknowledged": false
}

{
  "subscription": "KYC",
  "createdAt": 1734631643048,
  "id": "8......93",
  "userId": "17c.........f",
  "data": {
    "failureReason": "birthdate does not match",
    "id": "ce........8f",
    "kycStatus": "REJECTED",
    "level": 1,
    "reason": "",
    "status": "FAILED",
    "taxId": "46........29"
  },
  "acknowledged": false
}
```

### Useful links and tools
Random Tax-id generator: https://www.freetool.dev/cpf-generator