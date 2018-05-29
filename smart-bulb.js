module.exports = function(RED) {
	'use strict';
	const Client = require('tplink-smarthome-api').Client;
	function SmartBulbNode(config) {
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
	    if (deviceIP === null||deviceIP === '') {
			node.status({fill:'red',shape:'ring',text:'Not configured'});
			return false;
	    };
		node.status({fill:'grey',shape:'dot',text:'Initializing…'});

		//STARTING and PARAMETERS
		node.connectClient = function() {
			const client = new Client();
			client.getDevice({host:deviceIP})
			.then((device) => {
				node.deviceConnected = true;
				node.deviceInstance = device;
				device.startPolling(parseInt(node.config.interval));
				node.status({fill:'yellow',shape:'dot',text:'Connected'});
				device.on('lightstate-on', () => {node.sendPowerUpdateEvent(true)});
				device.on('lightstate-off', () => {node.sendPowerUpdateEvent(false)});
				device.on('device-online', () => {node.sendDeviceOnlineEvent(true)});
				device.on('device-offline', () => {node.sendDeviceOnlineEvent(false)});
				node.startPolling();
			})
			.catch(() => {return node.handleConnectionError()});
		};
		node.disconnectClient = function () {node.deviceConnected = false};
		node.isClientConnected = function () {return node.deviceConnected === true};
		node.startIsAlivePolling = function () {
			node.pingPolling = setInterval(function() {
        		if (node.isClientConnected()) node.deviceInstance.getInfo().catch(() => {return node.handleConnectionError()});
        		else return node.connectClient()
			}, parseInt(node.config.interval));
		};
		node.stopIsAlivePolling = function() {
			clearInterval(node.pingPolling);
			node.pingPolling = null;
		};
		node.startPolling = function() {
			node.eventPolling = setInterval(function() {
				if (node.deviceInstance === null) {
					node.stopPolling();
					return;
				}
				if (node.isClientConnected()) {
					if (node.checkAction('getInfoEvents')) node.sendDeviceSysInfo();
					if (node.checkAction('getMeterEvents')) node.sendDeviceMeterInfo();
				} else {
					node.status({fill:'red',shape:'ring',text:'Not reachable'});
					node.stopPolling();
					return false;
				}
			}, parseInt(node.config.eventInterval));
		};
		node.stopPolling = function () {
			clearInterval(node.eventPolling);
			node.eventPolling = null;
		};

		//INPUTS
		node.on('input', function(msg) {
			if (!node.isClientConnected()) return node.handleConnectionError('Not reachable');
			const EVENT_ACTIONS = ['getMeterEvents','getInfoEvents','getPowerUpdateEvents','getOnlineEvents'];
			if(msg.payload == true||msg.payload == false) {
				node.deviceInstance.setPowerState(msg.payload).then(() => {node.sendDeviceSysInfo()})
			.catch(error => {return node.handleConnectionError(error)});
			} else if (msg.payload.includes('brightness')) {
				const brightness = parseInt(msg.payload.split(':')[1]);
				node.deviceInstance.lighting.setLightState({brightness:brightness}).then(() => {node.sendDeviceSysInfo()})
				.catch(error => {return node.handleConnectionError(error)});
			} else if (msg.payload.includes('temperature')){
				const temperature = parseInt(msg.payload.split(':')[1]);
				node.deviceInstance.lighting.setLightState({color_temp:temperature}).then(() => {node.sendDeviceSysInfo()})
				.catch(error => {return node.handleConnectionError(error)})
			} else if (msg.payload === 'getInfo') node.sendDeviceSysInfo();
			else if (msg.payload === 'getMeterInfo') node.sendDeviceMeterInfo();
			else if (msg.payload === 'clearEvents') context.set('action', msg.payload);
			else if (msg.payload === 'eraseStats') node.sendEraseStatsResult();
			else {
				const actions = msg.payload.split('|');
				let enabledActions = [];
				actions.forEach(action => {
					if (EVENT_ACTIONS.indexOf(action) !== -1) enabledActions.push(action);
				});
				if (enabledActions.length > 0) context.set('action',enabledActions.join('|'));
				else context.set('action','');
			}
		});

		//EVENTS
		node.checkAction = function(action) {
			return context.get('action') !== undefined &&
			context.get('action') !== null &&
			context.get('action').includes(action);
		};
		node.sendDeviceSysInfo = function() {
			node.deviceInstance.getSysInfo()
			.then(info => {
				if (info.light_state.on_off === 1) {
					context.set('state','on');
					node.status({fill:'green',shape:'dot',text:'Turned ON'});
				} else {
					context.set('state','off');
					node.status({fill:'red',shape:'dot',text:'Turned OFF'});
				}
				let msg = {};
				msg.payload = info;
				msg.payload.timestamp = moment().format();
				node.send(msg);
			}).catch(error => {return node.handleConnectionError(error)});
		};
		node.sendPowerUpdateEvent = function(powerOn) {
			if (node.checkAction('getPowerUpdateEvents')) {
				let msg = {};
				msg.payload = {};
				msg.payload.powerOn = powerOn;
				msg.payload.timestamp = moment().format();
				node.send(msg);
			}
		};
		node.sendDeviceMeterInfo = function() {
			node.deviceInstance.emeter.getRealtime()
			.then(info => {
				const state = context.get('state') === 'on' ? 'Turned ON': 'Turned OFF';
				const power = numeral(info.power_mw).format('0.[00]')/1000;
				node.status({fill:'gray',shape:'dot',text:`${state} [${power}W]`});
				const msg = {};
				msg.payload = info;
				msg.payload.power_w = power;
				msg.payload.timestamp = moment().format();
				node.send(msg);
			}).catch(error => {return node.handleConnectionError(error)});
		};
		node.sendDeviceOnlineEvent = function(online) {
			if (node.checkAction('getOnlineEvents')) {
				let msg = {};
				msg.payload = {};
				msg.payload.online = online;
				msg.payload.timestamp = moment().format();
				node.send(msg);
			}
		};
		node.sendEraseStatsResult = function() {
			node.deviceInstance.emeter.eraseStats({})
			.then((result) => {
				const msg = {};
				msg.payload = result;
				node.send(msg);
			}).catch(error => {return node.handleConnectionError(error)});
		};
		node.handleConnectionError = function(error) {
			if (error) node.error(error);
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

	//Make available as node
	RED.nodes.registerType('smart-bulb',SmartBulbNode);
	RED.httpAdmin.get('/smarthome/bulbs',(req,res) => {
		try {
			const client = new Client();
			let discoveryTimeout = 10000;
			let devices = [];
			client.on('device-new',device => {devices.push(device.host)});
			client.startDiscovery({deviceTypes:['bulb']});
			setTimeout(() => {
				client.stopDiscovery();
				res.end(JSON.stringify(devices));
			}, discoveryTimeout);
		} catch(error) {res.sendStatus(500).send(error.message);}
	});
	RED.httpAdmin.get('/smarthome/bulb', (req, res) => {
		if (!req.query.ip) return res.status(500).send('Missing Device IP…');
		const client = new Client();
		client.getDevice({host: req.query.ip}).then(device => {res.end(device.model)}).catch(error => {res.sendStatus(500).send(error.message)});
	});
};