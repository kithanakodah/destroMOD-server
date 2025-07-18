"use strict";

const ZombieAI = require('./zombieAI.js');

class DestroMOD_AI_Plugin {
  name = "destroMOD";
  commands = [];
  attackCooldowns = new Map();
  config = {};

  // GAMEPLAY TUNING CONSTANTS (for zombies)
  ATTACK_COOLDOWN_MIN_MS = 1500;
  ATTACK_COOLDOWN_MAX_MS = 2500;
  AGGRO_RADIUS_MIN = 5.0;
  AGGRO_RADIUS_MAX = 10.0;
  ENRAGED_AGGRO_RADIUS = 75.0;
  ATTACK_RADIUS_MIN = 1.3;
  ATTACK_RADIUS_MAX = 1.8;
  MOVE_SPEED_MIN = 4.0;
  MOVE_SPEED_MAX = 14.0;
  MAX_VERTICAL_AGGRO_DISTANCE = 1.4;

  // --- ALERT MECHANIC ---
  ALERT_RADIUS = 20.0;               // How far the "shout" for help travels.
  ALERTED_AGGRO_RADIUS_MIN = 35.0;   // The new aggro range for alerted zombies.
  ALERTED_AGGRO_RADIUS_MAX = 45.0;

  constructor() {
    this.zombieAI = new ZombieAI(this);
  }

  loadConfig(config) {
    console.log(`[${this.name}] Loading configuration from destromod-config.yaml...`);
    this.config = config;
  }

  init(server) {
    console.log(`[${this.name}] Initializing AI`);
    this.zombieAI.startup(server);

    if (this.config.chatTextMessage) {
      setTimeout(() => {
        console.log(`[${this.name}] Please wait for the other window as it launches the game...`);
        server.sendDataToAll('SendChatText', {
          message: this.config.chatTextMessage,
          channel: 1
        });
      }, 5000);
    }
  }
}

module.exports = DestroMOD_AI_Plugin;