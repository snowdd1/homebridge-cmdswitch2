var exec = require("child_process").exec;
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-cmdswitch2", "cmdSwitch2", cmdSwitchPlatform, true);
}

function cmdSwitchPlatform(log, config, api) {
  this.log = log;
  this.config = config || {"platform": "cmdSwitch2"};
  this.switches = this.config.switches || [];

  this.accessories = {};

  if (api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
  }
}

// Method to restore accessories from cache
cmdSwitchPlatform.prototype.configureAccessory = function (accessory) {
  var self = this;
  var accessoryName = accessory.context.name;

  this.setService(accessory);
  this.accessories[accessoryName] = accessory;
}

// Method to setup accesories from config.json
cmdSwitchPlatform.prototype.didFinishLaunching = function () {
  // Add or update accessories defined in config.json
  for (var i in this.switches) {
    var data = this.switches[i];
    this.addAccessory(data);
  }

  // Remove extra accessories in cache
  for (var name in this.accessories) {
    var accessory = this.accessories[name];
    if (!accessory.reachable) {
      this.removeAccessory(accessory);
    }
  }
}

// Method to add and update HomeKit accessories
cmdSwitchPlatform.prototype.addAccessory = function (data) {
  var self = this;

  // Confirm variable type
  if (data.polling === true || (typeof(data.polling) === "string" && data.polling.toUpperCase() === "TRUE")) {
    data.polling = true;
  } else {
    data.polling = false;
  }

  data.interval = parseInt(data.interval) || 1;

  if (!this.accessories[data.name]) {
    var uuid = UUIDGen.generate(data.name);

    // Setup accessory as SWITCH (8) category.
    var newAccessory = new Accessory(data.name, uuid, 8);

    // New accessory is always reachable
    newAccessory.reachable = true;

    // Store and initialize variables into context
    newAccessory.context.name = data.name;
    newAccessory.context.on_cmd = data.on_cmd;
    newAccessory.context.off_cmd = data.off_cmd;
    newAccessory.context.state_cmd = data.state_cmd;
    newAccessory.context.polling = data.polling;
    newAccessory.context.interval = data.interval;
    newAccessory.context.state = false;
    if (data.off_cmd && !data.on_cmd && !data.state_cmd) newAccessory.context.state = true;

    // Setup HomeKit switch service
    newAccessory.addService(Service.Switch, data.name);

    // Setup listeners for different switch events
    this.setService(newAccessory);

    // Register accessory in HomeKit
    this.api.registerPlatformAccessories("homebridge-cmdswitch2", "cmdSwitch2", [newAccessory]);
  } else {
    // Retrieve accessory from cache
    var newAccessory = this.accessories[data.name];

    // Accessory is reachable if it's found in config.json
    newAccessory.updateReachability(true);

    // Update variables in context
    newAccessory.context.on_cmd = data.on_cmd;
    newAccessory.context.off_cmd = data.off_cmd;
    newAccessory.context.state_cmd = data.state_cmd;
    newAccessory.context.polling = data.polling;
    newAccessory.context.interval = data.interval;
  }

  // Retrieve initial state
  this.getInitState(newAccessory, data);

  // Store accessory in cache
  this.accessories[data.name] = newAccessory;

  // Configure state polling
  if (data.polling && data.state_cmd) this.statePolling(data.name);
}

// Method to remove accessories from HomeKit
cmdSwitchPlatform.prototype.removeAccessory = function (accessory) {
  if (accessory) {
    var name = accessory.context.name;
    this.log(name + " is removed from HomeBridge.");
    this.api.unregisterPlatformAccessories("homebridge-cmdswitch2", "cmdSwitch2", [accessory]);
    delete this.accessories[name];
  }
}

// Method to setup listeners for different events
cmdSwitchPlatform.prototype.setService = function (accessory) {
  accessory.getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('get', this.getPowerState.bind(this, accessory.context))
    .on('set', this.setPowerState.bind(this, accessory.context));

  accessory.on('identify', this.identify.bind(this, accessory.context));
}

// Method to retrieve initial state
cmdSwitchPlatform.prototype.getInitState = function (accessory, data) {
  var info = accessory.getService(Service.AccessoryInformation);

  if (data.manufacturer) {
    accessory.context.manufacturer = data.manufacturer;
    info.setCharacteristic(Characteristic.Manufacturer, data.manufacturer.toString());
  }

  if (data.model) {
    accessory.context.model = data.model;
    info.setCharacteristic(Characteristic.Model, data.model.toString());
  }

  if (data.serial) {
    accessory.context.serial = data.serial;
    info.setCharacteristic(Characteristic.SerialNumber, data.serial.toString());
  }

  if (!data.polling) {
    accessory.getService(Service.Switch)
      .getCharacteristic(Characteristic.On)
      .getValue();
  }
}

// Method to determine current state
cmdSwitchPlatform.prototype.getState = function (thisSwitch, callback) {
  var self = this;

  // Execute command to detect state
  exec(thisSwitch.state_cmd, function (error, stdout, stderr) {
    var state = stdout ? true : false;

    // Error detection
    if (stderr) {
      self.log("Failed to determine " + thisSwitch.name + " state.");
      self.log(stderr);
    }

    callback(stderr, state);
  });
}

// Method to determine current state
cmdSwitchPlatform.prototype.statePolling = function (name) {
  var self = this;
  var accessory = this.accessories[name];
  var thisSwitch = accessory.context;

  this.getState(thisSwitch, function (error, state) {
    // Update state if there's no error
    if (!error && state !== thisSwitch.state) {
      thisSwitch.state = state;
      accessory.getService(Service.Switch)
        .getCharacteristic(Characteristic.On)
        .getValue();
    }
  });

  // Setup for next polling
  setTimeout(this.statePolling.bind(this, name), thisSwitch.interval * 1000);
}

// Method to determine current state
cmdSwitchPlatform.prototype.getPowerState = function (thisSwitch, callback) {
  var self = this;

  if (thisSwitch.polling) {
    // Get state directly from cache if polling is enabled
    this.log(thisSwitch.name + " is " + (thisSwitch.state ? "on." : "off."));
    callback(null, thisSwitch.state);
  } else {
    // Check state if polling is disabled
    this.getState(thisSwitch, function (error, state) {
      // Update state if command exists
      if (thisSwitch.state_cmd) thisSwitch.state = state;
      if (!error) self.log(thisSwitch.name + " is " + (thisSwitch.state ? "on." : "off."));
      callback(error, thisSwitch.state);
    });
  }
}

// Method to set state
cmdSwitchPlatform.prototype.setPowerState = function (thisSwitch, state, callback) {
  var self = this;

  var cmd = state ? thisSwitch.on_cmd : thisSwitch.off_cmd;
  var notCmd = state ? thisSwitch.off_cmd : thisSwitch.on_cmd;
  var tout = null;

  // Execute command to set state
  exec(cmd, function (error, stdout, stderr) {
    // Error detection
    if (error && (state !== thisSwitch.state)) {
      self.log("Failed to turn " + (state ? "on " : "off ") + thisSwitch.name);
      self.log(stderr);
    } else {
      if (cmd) self.log(thisSwitch.name + " is turned " + (state ? "on." : "off."));
      thisSwitch.state = state;
      error = null;
    }

    // Restore switch after 1s if only one command exists
    if (!notCmd && !thisSwitch.state_cmd) {
      setTimeout(function () {
        self.accessories[thisSwitch.name].getService(Service.Switch)
          .setCharacteristic(Characteristic.On, !state);
      }, 1000);
    }

    if (tout) {
      clearTimeout(tout);
      callback(error);
    }
  });

  // Allow 1s to set state but otherwise assumes success
  tout = setTimeout(function () {
    tout = null;
    self.log("Turning " + (state ? "on " : "off ") + thisSwitch.name + " took too long, assuming success." );
    callback();
  }, 1000);
}

// Method to handle identify request
cmdSwitchPlatform.prototype.identify = function (thisSwitch, paired, callback) {
  this.log(thisSwitch.name + " identify requested!");
  callback();
}

// Method to handle plugin configuration in HomeKit app
cmdSwitchPlatform.prototype.configurationRequestHandler = function (context, request, callback) {
  if (request && request.type === "Terminate") {
    return;
  }

  // Instruction
  if (!context.step) {
    var instructionResp = {
      "type": "Interface",
      "interface": "instruction",
      "title": "Before You Start...",
      "detail": "Please make sure homebridge is running with elevated privileges.",
      "showNextButton": true
    }

    context.step = 1;
    callback(instructionResp);
  } else {
    switch (context.step) {
      case 1:
        // Operation choices
        var respDict = {
          "type": "Interface",
          "interface": "list",
          "title": "What do you want to do?",
          "items": [
            "Add New Switch",
            "Modify Existing Switch",
            "Remove Existing Switch"
          ]
        }

        context.step = 2;
        callback(respDict);
        break;
      case 2:
        var selection = request.response.selections[0];
        if (selection === 0) {
          // Info for new accessory
          var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": "New Switch",
            "items": [{
              "id": "name",
              "title": "Name (Required)",
              "placeholder": "HTPC"
            }]
          };

          context.operation = 0;
          context.step = 3;
          callback(respDict);
        } else {
          var self = this;
          var names = Object.keys(this.accessories).map(function (k) {return self.accessories[k].context.name});

          if (names.length > 0) {
            // Select existing accessory for modification or removal
            if (selection === 1) {
              var title = "Witch switch do you want to modify?";
              context.operation = 1;
            } else {
              var title = "Witch switch do you want to remove?";
              context.operation = 2;
            }
            var respDict = {
              "type": "Interface",
              "interface": "list",
              "title": title,
              "items": names
            };

            context.list = names;
            context.step = 3;
          } else {
            var respDict = {
              "type": "Interface",
              "interface": "instruction",
              "title": "Unavailable",
              "detail": "No switch is configured.",
              "showNextButton": true
            };

            context.step = 1;
          }
          callback(respDict);
        }
        break;
      case 3:
        if (context.operation === 2) {
          // Remove selected accessory from HomeKit
          var selection = context.list[request.response.selections[0]];
          var accessory = this.accessories[selection];

          this.removeAccessory(accessory);
          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Success",
            "detail": "The switch is now removed.",
            "showNextButton": true
          };

          context.step = 5;
        } else {
          if (context.operation === 0) {
            var data = request.response.inputs;
          } else if (context.operation === 1) {
            var selection = context.list[request.response.selections[0]];
            var data = this.accessories[selection].context;
          }

          if (data.name) {
            // Add/Modify info of selected accessory
            var respDict = {
              "type": "Interface",
              "interface": "input",
              "title": data.name,
              "items": [{
                "id": "on_cmd",
                "title": "CMD to Turn On",
                "placeholder": context.operation ? "Leave blank if unchanged" : "wakeonlan XX:XX:XX:XX:XX:XX"
              }, {
                "id": "off_cmd",
                "title": "CMD to Turn Off",
                "placeholder": context.operation ? "Leave blank if unchanged" : "net rpc shutdown -I XXX.XXX.XXX.XXX -U user%password"
              }, {
                "id": "state_cmd",
                "title": "CMD to Check ON State",
                "placeholder": context.operation ? "Leave blank if unchanged" : "ping -c 2 -W 1 XXX.XXX.XXX.XXX | grep -i '2 received'"
              }, {
                "id": "polling",
                "title": "Enable Polling (true/false)",
                "placeholder": context.operation ? "Leave blank if unchanged" : "false"
              }, {
                "id": "interval",
                "title": "Polling Interval",
                "placeholder": context.operation ? "Leave blank if unchanged" : "1"
              }, {
                "id": "manufacturer",
                "title": "Manufacturer",
                "placeholder": context.operation ? "Leave blank if unchanged" : "Default-Manufacturer"
              }, {
                "id": "model",
                "title": "Model",
                "placeholder": context.operation ? "Leave blank if unchanged" : "Default-Model"
              }, {
                "id": "serial",
                "title": "Serial",
                "placeholder": context.operation ? "Leave blank if unchanged" : "Default-SerialNumber"
              }]
            };

            delete context.list;
            delete context.operation;
            context.name = data.name;
            context.step = 4;
          } else {
            // Error if required info is missing
            var respDict = {
              "type": "Interface",
              "interface": "instruction",
              "title": "Error",
              "detail": "Name of the switch is missing.",
              "showNextButton": true
            };

            context.step = 1;
          }
        }
        callback(respDict);
        break;
      case 4:
        var userInputs = request.response.inputs;
        var newSwitch = {};

        // Setup input for addAccessory
        if (this.accessories[context.name]) {
          newSwitch = JSON.parse(JSON.stringify(this.accessories[context.name].context));
        }

        newSwitch.name = context.name;
        newSwitch.on_cmd = userInputs.on_cmd || newSwitch.on_cmd;
        newSwitch.off_cmd = userInputs.off_cmd || newSwitch.off_cmd;
        newSwitch.state_cmd = userInputs.state_cmd || newSwitch.state_cmd;
        newSwitch.polling = userInputs.polling || newSwitch.polling;
        newSwitch.interval = userInputs.interval || newSwitch.interval;
        newSwitch.manufacturer = userInputs.manufacturer;
        newSwitch.model = userInputs.model;
        newSwitch.serial = userInputs.serial;

        // Register or update accessory in HomeKit
        this.addAccessory(newSwitch);
        var respDict = {
          "type": "Interface",
          "interface": "instruction",
          "title": "Success",
          "detail": "The new switch is now updated.",
          "showNextButton": true
        };

        context.step = 5;
        callback(respDict);
        break;
      case 5:
        // Update config.json accordingly
        var self = this;
        delete context.step;
        var newConfig = this.config;
        var newSwitches = Object.keys(this.accessories).map(function (k) {
          var accessory = self.accessories[k];
          var data = {
            'name': accessory.context.name,
            'on_cmd': accessory.context.on_cmd,
            'off_cmd': accessory.context.off_cmd,
            'state_cmd': accessory.context.state_cmd,
            'polling': accessory.context.polling,
            'interval': accessory.context.interval,
            'manufacturer': accessory.context.manufacturer,
            'model': accessory.context.model,
            'serial': accessory.context.serial
          };
          return data;
        });

        newConfig.switches = newSwitches;
        callback(null, "platform", true, newConfig);
        break;
    }
  }
}
