//import createDeepstream from 'deepstream.io-client-js'
const DS = require( 'deepstream.io-client-js' );
const Stopwatch = require('timer-stopwatch');
const dsCredentials = require('./dsCredentials');
const raspi = require('raspi');
const gpio = require('raspi-gpio');
const I2C = require('raspi-i2c').I2C;

const client = DS(dsCredentials.url);

client.on('connectionStateChanged',state => {
  console.info(`Conection State: ${state}`);
});

client.on('error', (error, event, topic) => {
  console.info('Error -----------------------');
  console.info(error);
  console.info('Event -----------------------');
  console.info(event);
  console.info('Topic -----------------------');
  console.info(topic);
  if (event === 'connectionError' && connectionActive) {
    process.exit();
  }
});

//-----------------------------------------------------------------------------
// systemRecord & zonesRecord represent the state of our device. For our simulator, we get our initial
// state from deepstreamhub.  However, normaly we would get our initial state from the device.
//-----------------------------------------------------------------------------
let systemRecord = null;
let zonesRecord = null;
let eventsSubscribed = false;
let connectionActive = false;
//-----------------------------------------------------------------------------
// constants
//-----------------------------------------------------------------------------
const ZONE_BYPASS_EVENT = 'zones/toggleBypass'
const ZONE_TOGGLE_STATUS_EVENT = 'zones/toggleStatus';
const ARM_AWAY_EVENT = 'system/armAway';
const ARM_STAY_EVENT = 'system/armStay';
const DISARM_EVENT = 'system/disarm';
const ARM_AWAY_DELAY_START_TIME = 10000;

const OFFLINE = 'Offline';
const DISARMED = 'Not Armed';
const ARM_DELAY = 'Arm Delay';
const ARM_STAY = 'Armed Stay';
const ARM_AWAY = 'Armed Away';
const ALARM = 'Alarm';

const GREEN_LIGHT_CHAN = 0;
const YELLOW_LIGHT_CHAN = 1;
const RED_LIGHT_CHAN = 2;
const BUZZER_CHAN = 3;
const DIG_OUTPUT_ON = 1;
const DIG_OUTPUT_OFF = 0;

//-----------------------------------------------------------------------------
// Utility functions
//-----------------------------------------------------------------------------
const isDisarmed = state => state === DISARMED;
const isArmed = state => state === ARM_STAY || state === ARM_AWAY || state === ALARM;
const isArming = state => state === ARM_DELAY;
const getNewDisplay = (state,ready) => {
  if (state === DISARMED) {
    return ([state, ready ? 'Ready' : 'Not Ready']);
  }
  return ([state, '']);
}

const updateLightTower = (sysState, isReady = true, isTrouble = false) => {
  switch (sysState) {
    case OFFLINE:
    case DISARMED:
    case ARM_DELAY:
    setDigitalOut(GREEN_LIGHT_CHAN, isReady ? DIG_OUTPUT_ON : DIG_OUTPUT_OFF);
      setDigitalOut(YELLOW_LIGHT_CHAN, isReady ? DIG_OUTPUT_OFF : DIG_OUTPUT_ON);
      setDigitalOut(RED_LIGHT_CHAN, isTrouble ? DIG_OUTPUT_ON : DIG_OUTPUT_OFF);
      setDigitalOut(BUZZER_CHAN, DIG_OUTPUT_OFF);
      break;
    case ARM_STAY:
    case ARM_AWAY:
      setDigitalOut(GREEN_LIGHT_CHAN, DIG_OUTPUT_ON);
      setDigitalOut(YELLOW_LIGHT_CHAN, DIG_OUTPUT_OFF);
      setDigitalOut(RED_LIGHT_CHAN, DIG_OUTPUT_OFF);
      setDigitalOut(BUZZER_CHAN, DIG_OUTPUT_OFF);
      break;
    case ALARM:
      setDigitalOut(GREEN_LIGHT_CHAN, DIG_OUTPUT_OFF);
      setDigitalOut(YELLOW_LIGHT_CHAN, DIG_OUTPUT_OFF);
      setDigitalOut(RED_LIGHT_CHAN, DIG_OUTPUT_ON);
      setDigitalOut(BUZZER_CHAN, DIG_OUTPUT_ON);
      break;
  }
}
//-----------------------------------------------------------------------------
// armAwayTimer stuff
//-----------------------------------------------------------------------------
let armAwayTimer = new Stopwatch(ARM_AWAY_DELAY_START_TIME,{refreshRateMS: 100});
let lastAwayTime = 0;
let beepAwayTime = 0;
armAwayTimer
  .onTime(time => {
    const newAwayTime = Math.floor(time.ms/1000); 
    if (newAwayTime !== lastAwayTime) {
      setDigitalOut(BUZZER_CHAN, DIG_OUTPUT_ON);
      lastAwayTime = newAwayTime;
      if (systemRecord) {
        systemRecord.set('display.1',lastAwayTime + 1);
      }
    } else if (newAwayTime !== beepAwayTime) {
      setDigitalOut(BUZZER_CHAN, DIG_OUTPUT_OFF);
    }
  })
  .onDone(() => {
    updateLightTower(ARM_AWAY);
    if (systemRecord) {
      //console.info(getNewDisplay(ARM_AWAY,true));
      systemRecord.set('status.state',ARM_AWAY);
      systemRecord.set('display',getNewDisplay(ARM_AWAY,true));
    }
  });


   
const initializeSystemData = record => {
  systemRecord = record;
  console.info('systemRecord initialized')
  //let systemData = record.get();
  //console.info(`systemData: ${JSON.stringify(systemData)}`);
  //record.set('status.ready',false);
  //record.set('status.state',DISARMED);
  //record.set('display',getNewDisplay(DISARMED,false));
}

const toggleZ05 = () => {
  const path = 'Z05.status';
  if (systemRecord && zoneRecord && systemRecord.get('status.state')) {
    let status = zoneRecord.get(path);
    //console.info(`${path} = ${status}`)
    zoneRecord.set(path,status === 'Ready' ? 'Open' : 'Ready');
  }
}

const initializeZoneData = record => {
  console.info('zoneRecord initialized')
  zoneRecord = record;
  const zoneData = record.get();
  //console.info(`zoneData: ${JSON.stringify(zoneData)}`);
  //setInterval(toggleZ05,5000);
}

// https://stackoverflow.com/questions/27078285/simple-throttle-in-js
// Returns a function, that, when invoked, will only be triggered at most once
// during a given window of time. Normally, the throttled function will run
// as much as it can, without ever going more than once per `wait` duration;
// but if you'd like to disable the execution on the leading edge, pass
// `{leading: false}`. To disable execution on the trailing edge, ditto.
function throttle(func, wait, options) {
  var context, args, result;
  var timeout = null;
  var previous = 0;
  if (!options) options = {};
  var later = function() {
    previous = options.leading === false ? 0 : Date.now();
    timeout = null;
    result = func.apply(context, args);
    if (!timeout) context = args = null;
  };
  return function() {
    var now = Date.now();
    if (!previous && options.leading === false) previous = now;
    var remaining = wait - (now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = now;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };
}

const zonesChanged = data => {
  //console.info(Object.keys(data))
  let ready = true;
  let bypassCount = 0;
  let openCount = 0;
  let troubleCount = 0;
  let trouble = false;
  const ids = Object.keys(data);
  ids.map(id => {
    //console.info(data[id])
    const zone = data[id]
    if (zone.bypass) {
      bypassCount++;
    }
    switch (zone.status) {
      case 'Open': 
        openCount++;
        ready = ready && zone.bypass;
        break;
      case 'Trouble':
        troubleCount++;
        trouble = trouble || !zone.bypass;
        ready = ready && zone.bypass;
        break;
      default: break;
    }
  })

  const newAlerts = {
    openZones: openCount,
    troubleZones: troubleCount,
    bypassZones: bypassCount
  };
  systemRecord.set('alerts',newAlerts);
  systemRecord.set('status.ready',ready);
  let state = systemRecord.get('status.state');

  switch (state) {
    case OFFLINE:
    case DISARMED:
      systemRecord.set('display',getNewDisplay(state,ready));
      break;
    case ARM_DELAY:
      break;
    case ARM_STAY:
    case ARM_AWAY:
      if (!ready) {
        state = ALARM;
        systemRecord.set('status.state',state);
        systemRecord.set('display',getNewDisplay(state,ready));
      }
      break;
    case ALARM:
    default:
      break;
  }
  updateLightTower(state, ready, trouble);
}

//-----------------------------------------------------------------------------
// Event responses
//-----------------------------------------------------------------------------
const zoneBypassReceived = ({id}) => {
  console.info(`zoneBypassReceived: ${id}`)
  if (id && zonesRecord) {
    const path = `${id}.bypass`;
    const bypass = zonesRecord.get(path);
    zonesRecord.set(path,!bypass);
  }
}

const toggleZoneStatus = oldStatus => {
  switch(oldStatus) {
    case 'Ready': return 'Open'
    case 'Open': return 'Trouble'
    default: return 'Ready'
  }
}

const zoneToggleStatusReceived = ({id}) => {
  console.info(`zoneToggleStatusReceived: ${id}`)
  if (id) {
    const path = `${id}.status`;
    zonesRecord.set(path,toggleZoneStatus(zonesRecord.get(path)));
  }
}

const armAwayReceived = (data) => {
  console.info(`armAwayReceived: ${JSON.stringify(data)}`)
  //check code...obiously we don't care w/ simulator
  if (systemRecord) {
    let isReady = systemRecord.get('status.ready');
    systemRecord.set('status.state',ARM_DELAY);
    systemRecord.set('display',getNewDisplay(ARM_DELAY,isReady));
    armAwayTimer.reset(ARM_AWAY_DELAY_START_TIME);
    armAwayTimer.start();
    updateLightTower(ARM_DELAY,isReady);
  }
}

const armStayReceived = (data) => {
  console.info(`armStayReceived: ${JSON.stringify(data)}`)
  //check code...obiously we don't care w/ simulator
  if (systemRecord) {
    let isReady = systemRecord.get('status.ready');
    systemRecord.set('status.state',ARM_STAY);
    systemRecord.set('display',getNewDisplay(ARM_STAY,isReady));
    updateLightTower(ARM_STAY,isReady);
  }
}

const disarmReceived = (data) => {
  console.info(`disarmReceived: ${JSON.stringify(data)}`)
  armAwayTimer.stop();
  //check code...obiously we don't care w/ simulator
  if (systemRecord) {
    let isReady = systemRecord.get('status.ready');
    systemRecord.set('status.state',DISARMED);
    systemRecord.set('display',getNewDisplay(DISARMED,isReady));
    updateLightTower(DISARMED,isReady);
  }
}

/******************************************************************************
 * myInputChange will be called each time a zone input or digital input changes
 *****************************************************************************/
const myInputChange = (name, value) => {
  console.log(`${name} = ${value}`);
  switch (name) {
    case 'Z01':
    case 'Z02':
    case 'Z03':
    case 'Z04':
      if (zonesRecord) {
        const path = `${name}.status`;
        const currentStatus = zonesRecord.get(path);
        if (value != currentStatus) {
          zonesRecord.set(path,value);
        }
      }
      break;
    case 'DigitalInput1':
      if (zonesRecord) {
        const path = 'Z05.status';
        const currentStatus = zonesRecord.get(path);
        const newStatus = value === 0 ? 'Open' : 'Ready';
        if (newStatus != currentStatus) {
          zonesRecord.set(path,newStatus);
        }
      }
      break;
  }
};

//-----------------------------------------------------------------------------
// When we are logged in, we kick everything off
//-----------------------------------------------------------------------------
client.login(dsCredentials.authParams, (success, data) => {
  if (success) {
    connectionActive = true;
    console.log('login success');
    if (systemRecord === null) {
      systemRecord = client.record.getRecord('test/system');
      systemRecord.whenReady(initializeSystemData);
    }

    if (zonesRecord === null) {
      zonesRecord = client.record.getRecord('test/zones');
      zonesRecord.whenReady(initializeZoneData);
      zonesRecord.subscribe(throttle(zonesChanged,1000));
    }

    if (eventsSubscribed === false) {
      eventsSubscribed = true;
      client.event.subscribe(ZONE_BYPASS_EVENT,zoneBypassReceived);
      client.event.subscribe(ZONE_TOGGLE_STATUS_EVENT,zoneToggleStatusReceived);
      client.event.subscribe(ARM_AWAY_EVENT,armAwayReceived);
      client.event.subscribe(ARM_STAY_EVENT,armStayReceived);
      client.event.subscribe(DISARM_EVENT,disarmReceived);
    }
    
    onInputChange(myInputChange);
  }
});



/******************************************************************************
 ******************************************************************************
 ******************************************************************************
 * From here on is the Raspi.js specific stuff.  There is a simplistic callback
 * and function API so that the code above (platform independent) does not need
 * to be concerned with the low-level SPI of Raspi.
 * 
 * 
 * This config is based on the ADS1015 datasheet p. 8
 * BITS   Description
 * 15     1, trigger conversion
 * 14:12  100, MUX[2:0] single-ended AIN0
 * 11:9   000, Gain FS = ±6.144V
 * 8      1, single-shot acq mode
 * 7:5    111 3300SPS
 * 4      0
 * 3      0
 * 2      0
 * 1:0    11
 * 
 * MSB 11000001   0xC1
 * LSB 00000011   0xE3

  console.log("Reading Register 0");
  console.log(i2c.readSync(0x48 ,0x00, 2));
  console.log("Reading Register 1");
  console.log(i2c.readSync(0x48 ,0x01, 2));
  console.log("Reading Register 2");
  console.log(i2c.readSync(0x48 ,0x02, 2));
  console.log("Reading Register 3");
  console.log(i2c.readSync(0x48 ,0x03, 2));
 */


let inputChangedCallback = null;

const onInputChange = cb => { inputChangedCallback = cb; };

let digOutputsRef = null;
const setDigitalOut = (chan,value) => {
  if (digOutputsRef && chan >= 0 && chan <= 3) {
    let output = digOutputsRef[chan].value = value === 0 ? gpio.LOW : gpio.HIGH;
  }
};


function promiseDelay(delay, val) {
  return new Promise(function (resolve) {
    setTimeout(function () {
      resolve(val);
    }, delay);
  })
}

// chan is 0..3
const readAin = (i2c,chan) => {
  i2c.writeSync(0x48, 0x01, Buffer.from([0xC1| chan << 4, 0xE3]));
  promiseDelay(1, false);
  return (i2c.readSync(0x48, 0x00, 2).readInt16BE() >> 4);
};

const READY_TEXT = "Ready";
const OPEN_TEST = "Open";
const TROUBLE_TEXT = "Trouble";
const READY_A_D_LIMIT = 200;
const OPEN_A_D_LIMIT = 1400;

const zoneStatus = (value) => {
  if (value > READY_A_D_LIMIT) {
    if (value > OPEN_A_D_LIMIT) {
      return TROUBLE_TEXT;
    }
    return OPEN_TEST;
  }
  return READY_TEXT;
};

/*
 * Explorer pHAT GPIO Assignments
 * Input 1 P1-16
 * Input 2 P1-15
 * Input 3 P1-18
 * Input 4 P1-22
 * Output 1 P1-31
 * Output 2 P1-32
 * Output 3 P1-33
 * Output 4 P1-36

 * Automation pHAT GPIO Assignments
 * Input 1 P1-37
 * Input 2 P1-38
 * Input 3 P1-40
 * Output 1 P1-29
 * Output 2 P1-32
 * Output 3 P1-31
 * Relay    P1-36
 */

raspi.init(() => {
  console.log("raspi initialized");
  let zones = [
    { name: "Z01", input: 3, status: TROUBLE_TEXT },
    { name: "Z02", input: 2, status: TROUBLE_TEXT },
    { name: "Z03", input: 1, status: TROUBLE_TEXT },
    { name: "Z04", input: 0, status: TROUBLE_TEXT }
  ];
  let digInputs = [
    { name: "DigitalInput1", input: new gpio.DigitalInput({ pin: 'P1-16', pullResistor: gpio.PULL_UP }), value: gpio.LOW },
    { name: "DigitalInput2", input: new gpio.DigitalInput({ pin: 'P1-15', pullResistor: gpio.PULL_UP }), value: gpio.LOW },
    { name: "DigitalInput3", input: new gpio.DigitalInput({ pin: 'P1-18', pullResistor: gpio.PULL_UP }), value: gpio.LOW },
    { name: "DigitalInput4", input: new gpio.DigitalInput({ pin: 'P1-22', pullResistor: gpio.PULL_UP }), value: gpio.LOW }
  ];
  let digOutputs = [
    { name: "DigitalOutput1", output: new gpio.DigitalOutput('P1-31'), value: gpio.LOW },
    { name: "DigitalOutput2", output: new gpio.DigitalOutput('P1-32'), value: gpio.LOW },
    { name: "DigitalOutput3", output: new gpio.DigitalOutput('P1-33'), value: gpio.LOW },
    { name: "DigitalOutput4", output: new gpio.DigitalOutput('P1-36'), value: gpio.LOW }
  ];
  digOutputsRef = digOutputs;

  setInterval((i2c) => {
    // read digital inputs
    digInputs.map((input) => {
      let value = input.input.read();
      if (value !== input.value) {
        input.value = value;
        if (inputChangedCallback) {
          inputChangedCallback(input.name,input.value);
        }
      }
    });

    // read digital outputs
    digOutputs.map((output) => {
      output.output.write(output.value);
    });

    // read analog inputs
    zones.map((zone) => {
      let status = zoneStatus(readAin(i2c,zone.input));
      if (status !== zone.status) {
        zone.status = status;
        if (inputChangedCallback) {
          inputChangedCallback(zone.name,zone.status);
        }
      }
    });
  },100,new I2C());
});