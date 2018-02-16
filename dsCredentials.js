const dsCredentials = module.exports = {
  //url: 'wss://013.deepstreamhub.com?apiKey=c7b20154-5e81-48c4-a656-a887d82adc9c',
  url: 'ws://localhost:6020/deepstream',
  //url: 'ws://10.10.10.108:6020/deepstream', // gaspra on prototype wifi
  authParams: {
    type: 'email',
    email: 'user@domain.com',
    password: 'password'
  }
};

//export default dsCredentials;