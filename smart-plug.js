module.exports = function(RED) {
  'use strict';
  const Client = require('tplink-smarthome-api').Client;

  function SmartPlugNode(config) {
    RED.nodes.createNode(this, config);

    this.config = {
			name: config.name,
			device: config.device,
      interval: config.interval,
      eventInterval: config.eventInterval
    };

    const deviceIP = this.config.device;
    const moment = require('moment');
    const numeral = require('numeral');
		const context = this.context();
    const node = this;
    node.deviceInstance = null;
    node.deviceConnected = false;

    if (deviceIP === null || deviceIP === '') {
      node.status({fill: 'red', shape: 'ring', text: 'not configured'});
			return false;
    }

    node.status({fill: 'grey', shape: 'dot', text: 'initializing…'});

    node.connectClient = function () {
      const client = new Client();
      client.getDevice({
        host: deviceIP
      })
      .then((device) => {
        node.deviceConnected = true;
        node.deviceInstance = device;
        node.status({fill: 'green', shape: 'dot', text: 'connected'});
        device.on('power-on', () => {
          node.sendPowerUpdateEvent(true);
        });
        device.on('power-off', () => {
          node.sendPowerUpdateEvent(false);
        });
        device.on('in-use', () => {
          node.sendInUseEvent(true);
        });
        device.on('not-in-use', () => {
          node.sendInUseEvent(false);
        });
        device.on('device-online', () => {
          node.sendDeviceOnlineEvent(true);
        });
        device.on('device-offline', () => {
          node.sendDeviceOnlineEvent(false);
        });
        node.startPolling();
      })
      .catch(() => {
        return node.handleConnectionError();
      });
    };

    node.disconnectClient = function () {
      node.deviceConnected = false;
    };

    node.isClientConnected = function () {
      return node.deviceConnected === true;
    };

    node.startIsAlivePolling = function () {
      node.pingPolling = setInterval(function() {
        if (node.isClientConnected()) {
          node.deviceInstance.getInfo().catch(() => {
            return node.handleConnectionError();
          });
        } else {
          return node.connectClient();
        }
      }, parseInt(node.config.interval));
    };

    node.stopIsAlivePolling = function () {
      clearInterval(node.pingPolling);
      node.pingPolling = null;
    };

    node.startPolling = function () {
      node.eventPolling = setInterval(function() {
        if (node.deviceInstance === null) {
          node.stopPolling();
          return;
        }

        if (node.isClientConnected()) {
          if (node.checkAction('getInfoEvents')) {
            node.sendDeviceSysInfo();
          }
          if (node.checkAction('getMeterEvents')) {
            node.sendDeviceMeterInfo();
          }
        } else {
          node.status({fill: 'red', shape: 'ring', text: 'not reachable'});
          node.stopPolling();
          return false;
        }
      }, parseInt(node.config.eventInterval));
    };

    node.stopPolling = function () {
      clearInterval(node.eventPolling);
      node.eventPolling = null;
    };

    node.on('input', function(msg) {
      if (!node.isClientConnected()) {
        return node.handleConnectionError('not reachable');
      }

      const EVENT_ACTIONS = ['getMeterEvents', 'getInfoEvents', 'getPowerUpdateEvents', 'getInUseEvents', 'getOnlineEvents'];

      // Simple turn on / turn off
      if(msg.payload == true||msg.payload == false) {
        node.deviceInstance.setPowerState(msg.payload).then(() => {
          node.sendDeviceSysInfo();
        })
        .catch(error => {
          return node.handleConnectionError(error);
        });
      } else if (msg.payload === 'getInfo') {
        node.sendDeviceSysInfo();
      } else if (msg.payload === 'getMeterInfo') {
        node.sendDeviceMeterInfo();
      } else if (msg.payload === 'clearEvents') {
        context.set('action', msg.payload);
      } else if (msg.payload === 'eraseStats') {
        node.sendEraseStatsResult();
      } else {
        const actions = msg.payload.split('|');
        let enabledActions = [];
        actions.forEach(action => {
          if (EVENT_ACTIONS.indexOf(action) !== -1) {
            enabledActions.push(action);
          }
        });
        if (enabledActions.length > 0) {
          context.set('action', enabledActions.join('|'));
        } else {
          context.set('action', '');
        }
      }
    });

    node.checkAction = function (action) {
      return context.get('action') !== undefined &&
        context.get('action') !== null &&
        context.get('action').includes(action);
    };

    node.sendDeviceSysInfo = function () {
      node.deviceInstance.getSysInfo()
      .then(info => {
        if (info.relay_state === 1) {
          context.set('state', 'on');
          node.status({fill: 'yellow', shape: 'dot', text: 'turned on'});
        } else {
          context.set('state', 'off');
          node.status({fill: 'green', shape: 'dot', text: 'turned off'});
        }
        let msg = {};
        msg.payload = info;
        msg.payload.timestamp = moment().format();
        node.send(msg);
      })
      .catch(error => {
        return node.handleConnectionError(error);
      });
    };

    node.sendDeviceMeterInfo = function () {
      node.deviceInstance.emeter.getRealtime()
      .then(info => {
        const state = context.get('state') === 'on' ? 'turned on': 'turned off';
        const current = numeral(info.current).format('0.[000]');
        const voltage = numeral(info.voltage).format('0.[0]');
        const power = numeral(info.power).format('0.[00]');
        node.status({fill: 'yellow', shape: 'dot', text: `${state} [${power}W: ${voltage}V@${current}A]`});
        const msg = {};
        msg.payload = info;
        msg.payload.timestamp = moment().format();
        node.send(msg);
      })
      .catch(error => {
        return node.handleConnectionError(error);
      });
    };

    node.sendPowerUpdateEvent = function (powerOn) {
      if (node.checkAction('getPowerUpdateEvents')) {
        let msg = {};
        msg.payload = {};
        msg.payload.powerOn = powerOn;
        msg.payload.timestamp = moment().format();
        node.send(msg);
      }
    };

    node.sendInUseEvent = function (inUse) {
      if (node.checkAction('getInUseEvents')) {
        let msg = {};
        msg.payload = {};
        msg.payload.inUse = inUse;
        msg.payload.timestamp = moment().format();
        node.send(msg);
      }
    };

    node.sendDeviceOnlineEvent = function (online) {
      if (node.checkAction('getOnlineEvents')) {
        let msg = {};
        msg.payload = {};
        msg.payload.online = online;
        msg.payload.timestamp = moment().format();
        node.send(msg);
      }
    };

    node.sendEraseStatsResult = function () {
      node.deviceInstance.emeter.eraseStats({})
      .then((result) => {
        const msg = {};
        msg.payload = result;
        node.send(msg);
      })
      .catch(error => {
        return node.handleConnectionError(error);
      });
    };

    node.handleConnectionError = function (error) {
      if (error) {
        node.error(error);
      }
      node.status({fill: 'red', shape: 'ring', text: 'not reachable'});
      node.disconnectClient();
      return false;
    };

    node.on('close', function() {
      node.deviceConnected = false;
      node.stopPolling();
      node.stopIsAlivePolling();
    });

    node.connectClient();
    node.startIsAlivePolling();
  }
  RED.nodes.registerType('smart-plug', SmartPlugNode);

  RED.httpAdmin.get('/smarthome/plugs', (req, res) => {
    try {
      const client = new Client();
      let discoveryTimeout = 10000;
      let devices = [];
      client.on('device-new', device => {
        devices.push(device.host);
      });
      client.startDiscovery({deviceTypes: ['plug']});
      setTimeout(() => {
        client.stopDiscovery();
        res.end(JSON.stringify(devices));
      }, discoveryTimeout);
    } catch(error) {
      res.sendStatus(500).send(error.message);
    }
  });

  RED.httpAdmin.get('/smarthome/plug', (req, res) => {
    if (!req.query.ip) {
      return res.status(500).send('Missing Device IP…');
    }
    const client = new Client();
    client.getDevice({
      host: req.query.ip
    })
    .then(device => {
      res.end(device.model);
    })
    .catch(error => {
      res.sendStatus(500).send(error.message);
    });
  });

};
