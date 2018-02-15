//import createDeepstream from 'deepstream.io-client-js'
const ds = require( 'deepstream.io-client-js' );
const dsCredentials = require('./dsCredentials');


const client = ds(dsCredentials.url);

client.on('connectionStateChanged', state => {
  console.info(state)
})


client.login(dsCredentials.authParams, (success, data) => {
  if (success) {
    console.log('login success');
    let sysRecord = client.record.getRecord('test/system');

    sysRecord.whenReady(record => {
      const recordData = {
        display: [
          'UPDATED',
          ''
        ],
        status: {
          state: 'Offline',
          ready: false
        },
        alerts: {
          openZones: 1,
          troubleZones: 1,
          bypassZones: 1
        }
      };
      console.info(`writing record: ${JSON.stringify(recordData)}`);
      record.set(recordData);
    })

    let zonesRecord = client.record.getRecord('test/zones');
    
    zonesRecord.whenReady(record => {
      const recordData = {
        Z01: {
          name: 'Kitchen Entry Door',
          status: 'Ready',
          bypass: false
        },
        Z02: {
          name: 'Kitchen Windows',
          status: 'Ready',
          bypass: false
        },
        Z03: {
          name: 'Family Entry Door',
          status: 'Trouble',
          bypass: false
        },
        Z04: {
          name: 'Family Windows',
          status: 'Trouble',
          bypass: false
        },
        Z05: {
          name: 'Family Motion',
          status: 'Ready',
          bypass: false
        },
        Z06: {
          name: 'Dining windows',
          status: 'Ready',
          bypass: false
        },
        Z07: {
          name: 'Garage Door 1',
          status: 'Ready',
          bypass: false
        },
        Z08: {
          name: 'Garage Door 2',
          status: 'Ready',
          bypass: false
        },
        Z21: {
          name: 'Family Smoke',
          status: 'Ready',
          bypass: false
        },
        Z22: {
          name: '2nd Floor Smoke',
          status: 'Ready',
          bypass: false
        },
      };
      console.info(`writing record: ${JSON.stringify(recordData)}`);
      record.set(recordData);
    });
  }
});
