#!/usr/bin/env node

const axios = require('axios');
const readlineSync = require('readline-sync');
const {  fetchEvents }= require('./fetchHookEvents');

// Base API URL
const BASE_URL = 'https://api.brla.digital:5567/v1/business';
const EMAIL_PRODUCTION = ''

const API_URL_HOOK = ''; // Replit service for webhook events caching.

async function main() {
  try {
    const email = EMAIL_PRODUCTION;
    const password = readlineSync.question('Business Password: ', { hideEchoBack: true });
    
    const loginResponse = await axios.post(`${BASE_URL}/login`, {
      email,
      password
    }, {
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json'
      }
    });
    const token = loginResponse.data.accessToken;
    console.log('Login successful. Received token.');

    const taxId = readlineSync.question('User taxId to check/create: ');

    // Check if subaccount exists
    const checkResponse = await axios.get(`${BASE_URL}/subaccounts?taxId=${encodeURIComponent(taxId)}`, {
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`
      }
    });
    const subaccounts = checkResponse.data.subaccounts || [];

    if (subaccounts.length > 0) {
      console.log(`Subaccount for taxId "${taxId}" already exists:`);
      console.dir(subaccounts, { depth: null });
      return 
    } else {
      console.log(`No subaccount found for taxId "${taxId}".`);

      const fullName = readlineSync.question('Full Name: ');
      const birthDate = readlineSync.question('Birth Date (YYYY-MMMM-DD eg: 1990-Jun-01): ');
      const phone = readlineSync.question('Phone: ');
      
      console.log('Enter address details:');
      const cep = readlineSync.question('CEP: ');
      const city = readlineSync.question('City: ');
      const state = readlineSync.question('State: ');
      const street = readlineSync.question('Street: ');
      const number = readlineSync.question('Number: ');
      const district = readlineSync.question('District: ');

    // Workig test payload example  
    // const createPayload = {
    //     phone: "+551747694195",
    //     taxIdType: "CPF",
    //     address: {
    //       cep: "03819",
    //       city: "Florianopolis",
    //       state: "Santa Catarina",
    //       street: "Ferreira Lima",
    //       number: "82",
    //       district: "Sede"
    //     },
    //     fullName: "Joao Fernandez",
    //     cpf: taxId, 
    //     birthDate: "1990-Jun-02" 
    //   };

      const createPayload = {
        phone,
        taxIdType: "CPF",
        address: {
          cep,
          city,
          state,
          street,
          number,
          district
        },
        fullName,
        cpf: taxId, 
        birthDate 
      };

      console.log(createPayload);

      let user_id;
      try{
        const createResponse = await axios.post(`${BASE_URL}/subaccounts`, createPayload, {
            headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            'authorization': `Bearer ${token}`
            }
        });
        user_id = createResponse.data.id;
        console.log(`Subaccount created successfully with id ${user_id}, data: `, createResponse.data);
      } catch (createError) {
        console.error('Error creating subaccount:', createError.response ? createError.response.data : createError);
      }

      // Wait for KYC resopnse. Pending -> Approved, Rejected.
      let webHookEvent = await fetchEvents(user_id, API_URL_HOOK);
      if (webHookEvent.data.kycStatus == 'VERIFIED') {
        console.log('KYC approved. Subaccount created successfully.');
      } else {
        console.log('KYC rejected.');
      }

    }

  } catch (error) {
    console.error('An error occurred:', error.response ? error.response.data : error);
  }
}

main();
