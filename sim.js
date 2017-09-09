//import createDeepstream from 'deepstream.io-client-js'
const DS = require( 'deepstream.io-client-js' );
const Stopwatch = require('timer-stopwatch');
const dsCredentials = require('./dsCredentials');

const client = DS(dsCredentials.url);

//-----------------------------------------------------------------------------
// systemRecord & zonesRecord represent the state of our device. For our simulator, we get our initial
// state from deepstreamhub.  However, normaly we would get our initial state from the device.
//-----------------------------------------------------------------------------
let systemRecord = null;
let zonesRecord = null;

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

//-----------------------------------------------------------------------------
// armAwayTimer stuff
//-----------------------------------------------------------------------------
let armAwayTimer = new Stopwatch(ARM_AWAY_DELAY_START_TIME,{refreshRateMS: 250});
let lastAwayTime = 0;
armAwayTimer
  .onTime(time => {
    const newAwayTime = Math.floor(time.ms/1000); 
    if (systemRecord && newAwayTime != lastAwayTime) {
      lastAwayTime = newAwayTime;
      systemRecord.set('display.1',lastAwayTime);
    }
  })
  .onDone(() => {
    if (systemRecord) {
      //console.info(getNewDisplay(ARM_AWAY,true));
      systemRecord.set('status.state',ARM_AWAY);
      systemRecord.set('display',getNewDisplay(ARM_AWAY,true));
    }
  });


   
const initializeSystemData = record => {
  systemRecord = record;
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
  zoneRecord = record;
  const zoneData = record.get();
  console.info(`zoneData: ${JSON.stringify(zoneData)}`);
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
  const state = systemRecord.get('status.state');
  if (state === DISARMED) {
    systemRecord.set('display',getNewDisplay(state,ready));
  }
}

//-----------------------------------------------------------------------------
// Event responses
//-----------------------------------------------------------------------------
const zoneBypassReceived = ({id}) => {
  console.info(`zoneBypassReceived: ${id}`)
  if (id) {
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
    systemRecord.set('status.state',ARM_DELAY);
    systemRecord.set('display',getNewDisplay(ARM_DELAY,systemRecord.get('status.ready')));
    armAwayTimer.reset(ARM_AWAY_DELAY_START_TIME);
    armAwayTimer.start();
  }
}

const armStayReceived = (data) => {
  console.info(`armStayReceived: ${JSON.stringify(data)}`)
  //check code...obiously we don't care w/ simulator
  if (systemRecord) {
    systemRecord.set('status.state',ARM_STAY);
    systemRecord.set('display',getNewDisplay(ARM_STAY,systemRecord.get('status.ready')));
  }
}

const disarmReceived = (data) => {
  console.info(`disarmReceived: ${JSON.stringify(data)}`)
  armAwayTimer.stop();
  //check code...obiously we don't care w/ simulator
  if (systemRecord) {
    systemRecord.set('status.state',DISARMED);
    systemRecord.set('display',getNewDisplay(DISARMED,systemRecord.get('status.ready')));
  }
}

//-----------------------------------------------------------------------------
// When we are logged in, we kick everything off
//-----------------------------------------------------------------------------
client.login(dsCredentials.authParams, (success, data) => {
  if (success) {
    console.log('login success');
    systemRecord = client.record.getRecord('test/system');
    systemRecord.whenReady(initializeSystemData);

    zonesRecord = client.record.getRecord('test/zones');
    zonesRecord.whenReady(initializeZoneData);
    zonesRecord.subscribe(throttle(zonesChanged,1000));

    client.event.subscribe(ZONE_BYPASS_EVENT,zoneBypassReceived);
    client.event.subscribe(ZONE_TOGGLE_STATUS_EVENT,zoneToggleStatusReceived);
    client.event.subscribe(ARM_AWAY_EVENT,armAwayReceived);
    client.event.subscribe(ARM_STAY_EVENT,armStayReceived);
    client.event.subscribe(DISARM_EVENT,disarmReceived);
  }
});

