// Combined destroMOD Plugin - AGGRO-BASED PATHFINDING VERSION
// Only aggroed NPCs use crowd pathfinding, preventing agent leaks
"use strict";

const { spawn } = require('child_process');
const path = require('path');
const ZombieAI = require('./zombieAI.js');
const HumanAI = require('./humanAI.js');
const ArmorDamageSystem = require('./armorDamage.js');
const HumanShoot = require('./humanShoot.js');
const PathfindingManager = require('./pathfinding.js');
const DebugCommands = require('./debugCommands.js');

class DestroMOD_AI_Plugin {
  name = "destroMOD";
  
  attackCooldowns = new Map();
  shootCooldowns = new Map();
  config = {};
  lootBagCreated = new Set();

  // GAMEPLAY TUNING CONSTANTS (for zombies)
  ATTACK_COOLDOWN_MIN_MS = 1500;
  ATTACK_COOLDOWN_MAX_MS = 2500;
  AGGRO_RADIUS_MIN = 5.0;
  AGGRO_RADIUS_MAX = 10.0;
  ENRAGED_AGGRO_RADIUS = 75.0;
  ATTACK_RADIUS_MIN = 1.5;
  ATTACK_RADIUS_MAX = 1.8;
  MOVE_SPEED_MIN = 8.5;
  MOVE_SPEED_MAX = 8.5;
  MAX_VERTICAL_AGGRO_DISTANCE = 10.5;

  // --- ALERT MECHANIC ---
  ALERT_RADIUS = 5.0;
  ALERTED_AGGRO_RADIUS_MIN = 35.0;
  ALERTED_AGGRO_RADIUS_MAX = 45.0;

  // HUMAN NPC CONSTANTS
  SHOOT_RADIUS_MIN = 15.0;
  SHOOT_RADIUS_MAX = 25.0;
  ENRAGED_SHOOT_RADIUS = 50.0;
  ALERTED_SHOOT_RADIUS_MIN = 20.0;
  ALERTED_SHOOT_RADIUS_MAX = 30.0;
  SHOOT_COOLDOWN_MIN_MS = 2000;
  SHOOT_COOLDOWN_MAX_MS = 4000;

  constructor() {
    this.zombieAI = new ZombieAI(this);
    this.humanAI = new HumanAI(this);
    this.armorDamage = new ArmorDamageSystem(this);
    this.humanShoot = new HumanShoot(this);
    this.pathfinding = new PathfindingManager(this);
    this.hasSpawned = false;
    this.pathfindingProcess = null;

    this.debugCommands = new DebugCommands(this);
    this.commands = this.debugCommands.getCommands();
    
    console.log(`[${this.name}] destroMOD Plugin initialized with AGGRO-BASED pathfinding (${this.commands.length} commands)`);
  }

  loadConfig(config) {
    console.log(`[${this.name}] Loading configuration from destromod-config.yaml...`);
    this.config = config;
  }

  async init(server) {
    console.log(`[${this.name}] Starting 64-bit pathfinding service...`);
        
    // Launch the C++ service
    const servicePath = path.join(__dirname, 'pathfinding-service.exe');
    this.pathfindingProcess = spawn(servicePath, [], {
        cwd: __dirname,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    this.pathfindingProcess.stdout.on('data', (data) => {
        console.log(`[PathfindingService] ${data.toString().trim()}`);
    });

    this.pathfindingProcess.stderr.on('data', (data) => {
        console.error(`[PathfindingService] ERROR: ${data.toString().trim()}`);
    });

    // Wait a few seconds for service to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`[${this.name}] Initializing AI with AGGRO-BASED pathfinding`);

    const originalSendDeathMetrics = server.sendDeathMetrics.bind(server);
    server.sendDeathMetrics = function(client) {
      console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Death metrics called for: ${client?.character?.name || client?.character?.characterId || 'unknown'}`);
      
      if (!client?.character?.metrics) {
        console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Creating missing metrics object`);
        client.character.metrics = {};
      }
      
      if (!client.character.metrics.startedSurvivingTP || 
          typeof client.character.metrics.startedSurvivingTP !== 'number' ||
          client.character.metrics.startedSurvivingTP > Date.now()) {
        console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Fixing invalid startedSurvivingTP: ${client.character.metrics.startedSurvivingTP}`);
        client.character.metrics.startedSurvivingTP = Date.now();
      }
      
      const metrics = client.character.metrics;
      if (!metrics.recipesDiscovered || metrics.recipesDiscovered < 0) metrics.recipesDiscovered = 0;
      if (!metrics.zombiesKilled || metrics.zombiesKilled < 0) metrics.zombiesKilled = 0;
      if (!metrics.wildlifeKilled || metrics.wildlifeKilled < 0) metrics.wildlifeKilled = 0;
      if (!metrics.vehiclesDestroyed || metrics.vehiclesDestroyed < 0) metrics.vehiclesDestroyed = 0;
      if (!metrics.playersKilled || metrics.playersKilled < 0) metrics.playersKilled = 0;
      
      console.log(`[${server.destroMOD?.name || 'destroMOD'}] [DEATH_METRICS_FIX] Calling original sendDeathMetrics with fixed metrics`);
      return originalSendDeathMetrics(client);
    };

    this.zombieAI.startup(server);
    this.humanAI.startup(server);
    this.armorDamage.init(server);
    this.armorDamage.patchHitmarkerSystem(server);

    server.destroMOD = this;

    this.patchNPCDeathSystem(server);
    this.patchVisualEquipmentRemoval(server);

    this.pathfinding.setServer(server);
    // Initialize debug commands with server reference
    if (this.debugCommands && this.debugCommands.setServer) {
        this.debugCommands.setServer(server);
    }
    const pathfindingReady = await this.pathfinding.initialize();
    if (pathfindingReady) {
        server.sendChatText = server.sendChatText || (() => {}); 
        console.log(`[${this.name}] 🗺️ AGGRO-BASED pathfinding is now available!`);
        console.log(`[${this.name}] 📊 Only aggroed NPCs will use crowd simulation (capacity: 50 agents)`);
        
        setInterval(() => {
    if (this.pathfinding) {
        this.pathfinding.update(0.025);
    }
    if (this.debugCommands) {
        this.debugCommands.update(); // This will update the visualizer
    }
}, 50);
        console.log(`[${this.name}] Crowd simulation loop started (20Hz) for aggroed NPCs only.`);

        // REMOVED: No more bubble management - aggro-based system handles it automatically

    } else {
        console.log(`[${this.name}] ⚠️ Pathfinding unavailable - NPCs will use basic movement`);
    }

    this.setupAutoSpawn(server);

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

  // REMOVED: manageAIBubble function - no longer needed with aggro-based system

  patchVisualEquipmentRemoval(server) {
    console.log(`[${this.name}] Patching visual equipment removal system...`);
    
    const originalDamageItem = server.damageItem.bind(server);
    
    server.damageItem = function(character, item, damage) {
      let equipmentBackup = null;
      if (character.isHumanNPC === true && character._equipment) {
        equipmentBackup = JSON.parse(JSON.stringify(character._equipment));
      }
      
      const result = originalDamageItem(character, item, damage);
      
      if (character.isHumanNPC === true && item && item.currentDurability <= 0 && equipmentBackup) {
        console.log(`[${server.destroMOD?.name || 'destroMOD'}] [VISUAL_REMOVAL] Item ${item.itemDefinitionId} destroyed on NPC ${character.characterId}`);
        
        character._equipment = equipmentBackup;
        
        setTimeout(() => {
          const itemId = item.itemDefinitionId;
          
          if (itemId === 2271 || (character._loadout && character._loadout[38] && character._loadout[38].itemDefinitionId === itemId)) {
            console.log(`[${server.destroMOD?.name || 'destroMOD'}] [VISUAL_REMOVAL] Removing destroyed armor from EquipSlot 100...`);
            server.destroMOD.removeNPCEquipmentVisually(character, 100, 'armor', server);
          }
          
          if (itemId === 3414 || (character._loadout && character._loadout[11] && character._loadout[11].itemDefinitionId === itemId)) {
            console.log(`[${server.destroMOD?.name || 'destroMOD'}] [VISUAL_REMOVAL] Removing destroyed helmet from EquipSlot 1...`);
            server.destroMOD.removeNPCEquipmentVisually(character, 1, 'helmet', server);
          }
        }, 50);
      }
      
      return result;
    };
    
    console.log(`[${this.name}] Visual equipment removal system patched`);
  }

  removeNPCEquipmentVisually(npc, equipSlotId, itemType, server) {
    try {
      console.log(`[${this.name}] [VISUAL_REMOVAL] Removing ${itemType} from NPC ${npc.characterId} EquipSlot ${equipSlotId}`);
      
      const equipmentBefore = Object.keys(npc._equipment || {});
      console.log(`[${this.name}] [VISUAL_REMOVAL] Equipment before removal:`, equipmentBefore);
      
      if (!npc._equipment || !npc._equipment[equipSlotId]) {
        console.log(`[${this.name}] [VISUAL_REMOVAL] ERROR: Equipment slot ${equipSlotId} for ${itemType} not found!`);
        return;
      }
      
      const removedItem = npc._equipment[equipSlotId];
      console.log(`[${this.name}] [VISUAL_REMOVAL] About to remove: ${itemType} (${removedItem.modelName}) from EquipSlot ${equipSlotId}`);
      
      delete npc._equipment[equipSlotId];
      
      try {
        const remainingEquipment = Object.keys(npc._equipment || {});
        
        const equipmentSlots = remainingEquipment.map(slotId => ({
          equipmentSlotId: parseInt(slotId),
          equipmentSlotData: {
            equipmentSlotId: parseInt(slotId),
            guid: npc._equipment[slotId].guid,
            effectId: npc._equipment[slotId].effectId || 0,
            tintAlias: npc._equipment[slotId].tintAlias || "Default",
            decalAlias: npc._equipment[slotId].decalAlias || "#"
          }
        }));
        
        const attachmentData = remainingEquipment.map(slotId => ({
          modelName: npc._equipment[slotId].modelName,
          effectId: npc._equipment[slotId].effectId || 0,
          textureAlias: npc._equipment[slotId].textureAlias || "Default",
          tintAlias: npc._equipment[slotId].tintAlias || "Default",
          decalAlias: npc._equipment[slotId].decalAlias || "#",
          slotId: parseInt(slotId),
          SHADER_PARAMETER_GROUP: npc._equipment[slotId].SHADER_PARAMETER_GROUP || []
        }));
        
        server.sendDataToAllWithSpawnedEntity(
          server._npcs,
          npc.characterId,
          "Equipment.SetCharacterEquipment",
          {
            characterData: {
              profileId: 5,
              characterId: npc.characterId
            },
            unknownDword1: 0,
            tintAlias: "Default",
            decalAlias: "#",
            equipmentSlots: equipmentSlots,
            attachmentData: attachmentData,
            unknownBoolean1: true
          }
        );
        console.log(`[${this.name}] [VISUAL_REMOVAL] Sent SetCharacterEquipment update - removed ${itemType}, ${remainingEquipment.length} items remaining`);
        
      } catch (error) {
        console.log(`[${this.name}] [VISUAL_REMOVAL] Method 1 failed:`, error.message);
      }
      
      console.log(`[${this.name}] [VISUAL_REMOVAL] Successfully removed ${itemType} from EquipSlot ${equipSlotId}`);
      
    } catch (error) {
      console.error(`[${this.name}] [VISUAL_REMOVAL] Error removing ${itemType} visually:`, error);
    }
  }

  createHumanNPCLootBag(server, npc) {
    try {
      console.log(`[${this.name}] Creating human NPC loot bag...`);
      
      const { Lootbag } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/lootbag'));
      const { ModelIds } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/models/enums'));
      
      const lootbagCharacterId = this.generateGuid(server);
      
      const lootbag = new Lootbag(
        lootbagCharacterId,
        server.getTransientId(lootbagCharacterId),
        ModelIds.LOOT_BAG_LARGE,
        new Float32Array([
          npc.state.position[0] + 0.7,
          npc.state.position[1] + 0.1,
          npc.state.position[2] + 0.7
        ]),
        new Float32Array([0, 0, 0, 0]),
        server
      );
      
      const container = lootbag.getContainer();
      if (container) {
        this.addHumanNPCLoot(server, null, lootbag, container, npc);
      }
      
      server._lootbags[lootbagCharacterId] = lootbag;
      console.log(`[${this.name}] Human NPC loot bag created: ${lootbagCharacterId}`);
      
    } catch (error) {
      console.error(`[${this.name}] Error creating human NPC loot bag:`, error);
    }
  }

  setupAutoSpawn(server) {
    console.log(`[${this.name}] Setting up auto-spawn system...`);
    
    const spawnCheck = setInterval(() => {
      const clients = Object.values(server._clients);
      const connectedClient = clients.find(client => client && client.character && client.character.isAlive);
      
      if (connectedClient && !this.hasSpawned) {
        console.log(`[${this.name}] Found connected client: ${connectedClient.character.name}, spawning NPCs`);
        this.hasSpawned = true;
        clearInterval(spawnCheck);
        
        server.sendChatText(connectedClient, "=== destroMOD Active (AGGRO-BASED) ===");
        server.sendChatText(connectedClient, "📊 Only aggroed NPCs use advanced pathfinding");
        server.sendChatText(connectedClient, "🎯 Idle NPCs use basic movement (saves resources)");
        server.sendChatText(connectedClient, "Spawning test NPCs now...");
        
        setTimeout(() => {
          this.spawnTestNPCs(server, connectedClient);
          
          this.waitForPlayerReady(server, connectedClient, () => {
            console.log(`[${this.name}] Player is fully loaded, sending equipment to NPCs...`);
            this.equipAllHumanNPCs(server, connectedClient);
          });
          
        }, 2000);
      }
    }, 5000);
    
    console.log(`[${this.name}] Auto-spawn system ready - checking for players every 5 seconds`);
  }

  spawnTestNPCs(server, client) {
    console.log(`[${this.name}] Spawning test human NPC for ${client.character?.name}`);
    
    try {
      const humanSpawned = this.spawnHumanNPC(server, client);
      
      if (humanSpawned) {
        server.sendChatText(client, "✅ Spawned 1 human NPC with AGGRO-BASED pathfinding!");
        server.sendChatText(client, "🎯 NPC will use crowd simulation only when aggroed");
        server.sendChatText(client, "💡 Attack it to see advanced pathfinding in action");
        server.sendChatText(client, "Equipment will be applied when you're fully loaded");
        server.sendChatText(client, "Commands: /debug_npc <id>, /scan_npc_items <id>, /list_npcs");
        server.sendChatText(client, "Crowd: /crowd_stats, /crowd_health");
        console.log(`[${this.name}] Successfully spawned human NPC with aggro-based pathfinding`);
      } else {
        server.sendChatText(client, "❌ Failed to spawn human NPC - check server console");
        console.log(`[${this.name}] Failed to spawn human NPC`);
      }
      
    } catch (error) {
      console.error(`[${this.name}] Error spawning human NPC:`, error);
      server.sendChatText(client, "❌ Error spawning NPC - check server console");
    }
  }

  spawnHumanNPC(server, client) {
    try {
      console.log(`[${this.name}] Spawning human NPC with AGGRO-BASED pathfinding...`);
      
      const characterId = server.generateGuid();
      const transient = server.getTransientId(characterId);
      
      const randomXOffset = (Math.random() * 10) - 5;
      const randomZOffset = (Math.random() * 10) + 20;

      const spawnPos = [
        client.character.state.position[0] + randomXOffset,
        client.character.state.position[1],
        client.character.state.position[2] + randomZOffset,
        1
      ];
      
      const { Npc } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/npc'));
      
      const humanNpc = new Npc(
        characterId,
        transient,
        9469, 
        spawnPos,
        client.character.state.rotation,
        server
      );

      humanNpc.isHumanNPC = true;
      humanNpc.health = 8000;
      humanNpc.maxHealth = 8000;
      humanNpc.npcMeleeDamage = 0;
      humanNpc.weapon = 2229;

      // AGGRO-BASED: Initialize aggro tracking
      humanNpc.wasAggroed = false;
      humanNpc.aiState = 'IDLE';
      
      humanNpc.metrics = {
        recipesDiscovered: 0,
        zombiesKilled: 0,
        startedSurvivingTP: Date.now(),
        wildlifeKilled: 0,
        vehiclesDestroyed: 0,
        playersKilled: 0
      };
      console.log(`[${this.name}] Initialized NPC metrics for ${characterId} to prevent death metrics errors`);
      
      humanNpc.headActor = "SurvivorMale_Head_01.adr";
      humanNpc.gender = 1;
      humanNpc.loadoutId = 5;
      humanNpc.currentLoadoutSlot = 1;
      
      humanNpc._loadout = {};
      humanNpc._equipment = {};
      humanNpc._containers = {};

      humanNpc.lastShotTime = 0;
      humanNpc.shotCooldown = 1500;
      humanNpc.detectionRange = 25;
      humanNpc.shootingRange = 20;
      humanNpc.currentTarget = null;
      humanNpc.isHostile = true;
      humanNpc.hasWeapon = false;
      humanNpc.weaponItemDefinitionId = 2229;
      humanNpc.weaponAmmoId = 2325;
      humanNpc.ammoCount = 30;
      humanNpc.isAiming = false;
      humanNpc.burstCount = 0;
      humanNpc.maxBurstShots = 3;
      humanNpc.burstCooldown = 3000;
      humanNpc.lastBurstTime = 0;

      this.addEnhancedShootingMethods(humanNpc, server);
      
      const weaponGuid = this.generateGuid(server);
      const armorGuid = this.generateGuid(server);
      const helmetGuid = this.generateGuid(server);

      const weaponDef = server.getItemDefinition(2229);
      
      const weaponItem = server.generateItem(2229, 1, 100);
      weaponItem.itemGuid = weaponGuid;
      
      console.log(`[${this.name}] [DEBUG] Starting equipment setup for AGGRO-BASED NPC...`);
      
      const armorDef = server.getItemDefinition(2271);
      const armorId = 2271;

      if (!armorDef) {
        console.error(`[${this.name}] CRITICAL ERROR: Armor ID 2271 not found in server definitions!`);
        return false;
      }

      console.log(`[${this.name}] Using Laminated Tactical Body Armor (ID: 2271)`);

      const helmetDef = server.getItemDefinition(3414);
      const helmetId = 3414;

      if (!helmetDef) {
        console.error(`[${this.name}] CRITICAL ERROR: Helmet ID 3414 not found in server definitions!`);
        return false;
      }

      console.log(`[${this.name}] Using Firefighter Tactical Helmet (ID: 3414)`);
      
      humanNpc._loadout = {};
      humanNpc._equipment = {};
      
      humanNpc._equipmentDurability = {};
      
      if (weaponDef) {
        console.log(`[${this.name}] Setting up AK-47 equipment...`);
        
        humanNpc._loadout[1] = {
          itemDefinitionId: 2229,
          itemGuid: weaponGuid,
          slotId: 1,
          stackCount: 1,
          currentDurability: 1000,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId,
          weapon: weaponItem.weapon
        };
        
        humanNpc._equipmentDurability[2229] = 1000;
        
        const equipmentSlotId = weaponDef.ACTIVE_EQUIP_SLOT_ID || 7;
        humanNpc._equipment[equipmentSlotId] = {
          modelName: weaponDef.MODEL_NAME || "Weapon_AK47_3P.adr",
          slotId: equipmentSlotId,
          guid: weaponGuid,
          textureAlias: weaponDef.TEXTURE_ALIAS || "Default",
          effectId: weaponDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(2229) || []
        };
        console.log(`[${this.name}] HYBRID: Weapon added to both LoadoutSlot 1 (protection) and EquipSlot ${equipmentSlotId} (visual)`);
      } else {
        console.log(`[${this.name}] [ERROR] Could not find weapon definition for AK-47 (2229)`);
      }
      
      console.log(`[${this.name}] [DEBUG] Starting armor setup - armorDef exists: ${!!armorDef}`);
      if (armorDef) {
        console.log(`[${this.name}] Setting up Laminated Tactical Body Armor (ID: ${armorId})...`);
        
        humanNpc._loadout[38] = {
          itemDefinitionId: armorId,
          itemGuid: armorGuid,
          slotId: 38,
          stackCount: 1,
          currentDurability: 1000,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId
        };
        
        humanNpc._equipmentDurability[armorId] = 1000;
        
        const armorEquipSlotId = armorDef.PASSIVE_EQUIP_SLOT_ID || 100;
        
        let modelName = armorDef.MODEL_NAME || "SurvivorMale_Armor_Kevlar_Basic_Velcro.adr";
        if (modelName.includes("<gender>")) {
          modelName = modelName.replace("<gender>", humanNpc.gender === 1 ? "Male" : "Female");
        }
        
        humanNpc._equipment[armorEquipSlotId] = {
          modelName: modelName,
          slotId: armorEquipSlotId,
          guid: armorGuid,
          textureAlias: armorDef.TEXTURE_ALIAS || "Default",
          effectId: armorDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(armorId) || []
        };
        
        console.log(`[${this.name}] HYBRID: Armor added to LoadoutSlot 38 (protection) and EquipSlot ${armorEquipSlotId} (visual)`);
      }
      
      console.log(`[${this.name}] [DEBUG] Starting helmet setup - helmetDef exists: ${!!helmetDef}`);
      if (helmetDef) {
        console.log(`[${this.name}] Setting up Firefighter Tactical Helmet (ID: ${helmetId})...`);
        
        humanNpc._loadout[11] = {
          itemDefinitionId: helmetId,
          itemGuid: helmetGuid,
          slotId: 11,
          stackCount: 1,
          currentDurability: 100,
          containerGuid: "0xFFFFFFFFFFFFFFFF",
          loadoutItemOwnerGuid: humanNpc.characterId
        };
        
        humanNpc._equipmentDurability[helmetId] = 100;
        
        let helmetModelName = helmetDef.MODEL_NAME || "SurvivorMale_Head_Helmet_ParaMilitary.adr";
        if (helmetModelName.includes("<gender>")) {
          helmetModelName = helmetModelName.replace("<gender>", humanNpc.gender === 1 ? "Male" : "Female");
        }
        
        const helmetEquipSlotId = helmetDef.PASSIVE_EQUIP_SLOT_ID || 1;
        
        humanNpc._equipment[helmetEquipSlotId] = {
          modelName: helmetModelName,
          slotId: helmetEquipSlotId,
          guid: helmetGuid,
          textureAlias: helmetDef.TEXTURE_ALIAS || "Default",
          effectId: helmetDef.EFFECT_ID || 0,
          tintAlias: "Default",
          decalAlias: "#",
          SHADER_PARAMETER_GROUP: server.getShaderParameterGroup(helmetId) || []
        };
        
        console.log(`[${this.name}] HYBRID: Helmet added to LoadoutSlot 11 (protection) and EquipSlot ${helmetEquipSlotId} (visual)`);
      }
      console.log(`[${this.name}] [DEBUG] About to add AGGRO-BASED NPC to server...`);
      
      server._npcs[characterId] = humanNpc;
      console.log(`[${this.name}] [DEBUG] Added NPC to server._npcs`);
      
      server.aiManager.addEntity(humanNpc);
      console.log(`[${this.name}] [DEBUG] Added NPC to aiManager (will be added to crowd when aggroed)`);
      
      humanNpc.needsEquipmentSetup = true;
      
      console.log(`[${this.name}] Human NPC ${characterId} spawned with AGGRO-BASED pathfinding (not in crowd until aggroed)`);
      return true;
      
    } catch (error) {
      console.error(`[${this.name}] Error spawning human NPC:`, error);
      console.error(`[${this.name}] Stack trace:`, error.stack);
      return false;
    }
  }

  addEnhancedShootingMethods(npc, server) {
    const serverModulePath = path.join(process.cwd(), 'node_modules/h1z1-server');
    const { getCurrentServerTimeWrapper } = require(path.join(serverModulePath, 'out/utils/utils'));

    npc.playWeaponEffects = function() {
      console.log(`[HumanNPC] ${this.characterId} playing enhanced weapon effects`);
      const realClients = Object.values(server._clients).filter(client => client && client.character && !client.character.isHumanNPC && client.sessionId && client.spawnedEntities && client.spawnedEntities.has(this));
      console.log(`[HumanNPC] Sending effects to ${realClients.length} clients who can see NPC`);
      realClients.forEach(client => {
        try {
          server.sendData(client, "Weapon.Fire", {
            characterId: this.characterId,
            sessionProjectileCount: Math.floor(Math.random() * 1000000),
            weaponGuid: this._loadout[1]?.itemGuid || "0x1234567890",
            position: new Float32Array([ this.state.position[0], this.state.position[1] + 1.6, this.state.position[2], 1]),
            unknownVector: [0, 0, 0, 0],
            projectileCount: 1
          });
        } catch (error) {
          console.warn(`[HumanNPC] Could not send weapon fire to client ${client.sessionId}:`, error.message);
        }
      });
    };

    npc.createMissEffect = function(target) {
      try {
        const missOffset = 2 + Math.random() * 3;
        const missAngle = Math.random() * 2 * Math.PI;
        
        const missPos = new Float32Array([
          target.state.position[0] + Math.sin(missAngle) * missOffset,
          target.state.position[1],
          target.state.position[2] + Math.cos(missAngle) * missOffset,
          1
        ]);
        
        const bulletEffects = [5343, 5180, 5181, 1165, 99];
        const effectId = bulletEffects[Math.floor(Math.random() * bulletEffects.length)];
        
        server.sendDataToAllWithSpawnedEntity(
          server._characters,
          target.characterId,
          "Character.PlayWorldCompositeEffect",
          {
            characterId: target.characterId,
            effectId: effectId,
            position: missPos
          }
        );
      } catch (error) {
        console.warn(`[HumanNPC] Could not create miss effect:`, error.message);
      }
    };

    npc.calculateBallisticTrajectory = function(target, startPos) {
      const targetPos = new Float32Array([
        target.state.position[0],
        target.state.position[1] + 0.9,
        target.state.position[2]
      ]);
      
      const dx = targetPos[0] - startPos[0];
      const dy = targetPos[1] - startPos[1];
      const dz = targetPos[2] - startPos[2];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      const spreadAngle = 0.02;
      const horizontalSpread = (Math.random() - 0.5) * spreadAngle;
      const verticalSpread = (Math.random() - 0.5) * spreadAngle;
      
      return new Float32Array([
        (dx / distance) + horizontalSpread,
        (dy / distance) + verticalSpread,
        (dz / distance),
        1
      ]);
    };

    npc.simulateWeaponFire = function(target) {
      try {
        const distance = this.getDistanceToPosition(target.state.position);
        const hitChance = Math.max(0.3, 1.0 - (distance / 80));
        
        const bulletSpeed = 300;
        const travelTime = Math.min((distance / bulletSpeed) * 1000, 500);
        
        setTimeout(() => {
          if (Math.random() < hitChance && target.isAlive) {
            this.applyProjectileDamage(target, distance);
          } else {
            this.createMissEffect(target);
          }
        }, travelTime);
      } catch (error) {
        console.error(`[HumanNPC] Error simulating weapon fire:`, error);
      }
    };

    npc.applyProjectileDamage = function(target, distance) {
      try {
        let baseDamage = 300;
        const damageFalloff = Math.max(0.4, 1.0 - (distance / 150));
        const finalDamage = Math.floor(baseDamage * damageFalloff);
        const targetClient = server.getClientByCharId(target.characterId);
        if (targetClient) {
          const damageInfo = {
            entity: this.characterId,
            damage: finalDamage,
            weapon: this.weaponItemDefinitionId,
            hitReport: { 
              sessionProjectileCount: 1,
              characterId: target.characterId,
              position: target.state.position,
              unknownFlag1: 0,
              unknownByte2: 0,
              totalShotCount: 1,
              hitLocation: this.determineHitLocation() 
            }
          };
          target.damage(server, damageInfo);
        }
      } catch (error) {
        console.error(`[HumanNPC] Error applying damage:`, error);
      }
    };

    npc.determineHitLocation = function() {
      const hitLocations = ["BODY", "BODY", "BODY", "ARM", "LEG", "HEAD"];
      return hitLocations[Math.floor(Math.random() * hitLocations.length)];
    };

    npc.getDistanceToPosition = function(targetPos) {
      const dx = this.state.position[0] - targetPos[0];
      const dy = this.state.position[1] - targetPos[1];
      const dz = this.state.position[2] - targetPos[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    npc.aimAtTarget = function(target) {
      const dx = target.state.position[0] - this.state.position[0];
      const dz = target.state.position[2] - this.state.position[2];
      this.state.rotation = new Float32Array([0, Math.atan2(dx, dz), 0, 1]);
      this.isAiming = true;
      this.sendPositionUpdate();
    };

    npc.sendPositionUpdate = function() {
      server.sendDataToAllWithSpawnedEntity(
        server._npcs, this.characterId, "PlayerUpdatePosition",
        {
          transientId: this.transientId,
          positionUpdate: {
            sequenceTime: getCurrentServerTimeWrapper().getTruncatedU32(),
            position: this.state.position,
            unknown3_int8: 0,
            stance: 1,
            engineRPM: 0,
            orientation: this.state.rotation[1],
            frontTilt: 0,
            sideTilt: 0,
            angleChange: 0,
            verticalSpeed: 0,
            horizontalSpeed: 0
          }
        }
      );
    };
    
    const originalTryShoot = server.destroMOD.humanShoot.tryShoot.bind(server.destroMOD.humanShoot);
    server.destroMOD.humanShoot.tryShoot = function(npc, target) {
      const now = Date.now();
      const canShootAt = server.destroMOD.shootCooldowns.get(npc.characterId) || 0;
      if (now >= canShootAt) {
        const randomCooldown = Math.random() * (server.destroMOD.SHOOT_COOLDOWN_MAX_MS - server.destroMOD.SHOOT_COOLDOWN_MIN_MS) + server.destroMOD.SHOOT_COOLDOWN_MIN_MS;
        server.destroMOD.shootCooldowns.set(npc.characterId, now + randomCooldown);
        if (npc.aimAtTarget) npc.aimAtTarget(target);
        if (npc.playWeaponEffects) npc.playWeaponEffects();
        if (npc.simulateWeaponFire) npc.simulateWeaponFire(target);
        else originalTryShoot(npc, target);
      }
    };
  }

  waitForPlayerReady(server, client, callback) {
    // Set 5-second grace period for new players
    if (client && client.character) {
        client.character.gameReadyTime = Date.now();
        console.log(`[${this.name}] Set 5-second aggro grace period for player ${client.character.name}`);
    }
    
    let hasExecuted = false;
    const checkInterval = setInterval(() => {
        if (client && client.character && client.character.initialized && !client.isLoading && !hasExecuted) {
            console.log(`[${this.name}] Player ${client.character.name} is ready!`);
            hasExecuted = true;
            clearInterval(checkInterval);
            callback();
        }
    }, 1000);
    setTimeout(() => {
        if (!hasExecuted) {
            console.log(`[${this.name}] Player ready timeout - forcing equipment setup`);
            hasExecuted = true;
            clearInterval(checkInterval);
            callback();
        }
    }, 30000);
}

  equipAllHumanNPCs(server, client) {
    console.log(`[EQUIP_ALL] Starting to equip all human NPCs...`);
    const humanModelNpcs = Object.keys(server._npcs).filter(id => server._npcs[id].actorModelId === 9469);
    console.log(`[EQUIP_ALL] Found ${humanModelNpcs.length} human model NPCs to equip`);
    humanModelNpcs.forEach((npcId, index) => {
      const npc = server._npcs[npcId];
      if (!npc.isHumanNPC) {
        npc.isHumanNPC = true;
        npc.weapon = 2229;
        npc.gender = 1;
        npc.loadoutId = 5;
        npc.currentLoadoutSlot = 1;
        npc.wasAggroed = false; // AGGRO-BASED: Initialize aggro tracking
      }
      if (npc._equipment && Object.keys(npc._equipment).length > 0) {
        setTimeout(() => {
          try {
            const equipmentSlots = Object.keys(npc._equipment).map(slotId => ({
              equipmentSlotId: parseInt(slotId),
              equipmentSlotData: {
                equipmentSlotId: parseInt(slotId),
                guid: npc._equipment[slotId].guid,
                effectId: npc._equipment[slotId].effectId || 0,
                tintAlias: npc._equipment[slotId].tintAlias || "Default",
                decalAlias: npc._equipment[slotId].decalAlias || "#"
              }
            }));
            const attachmentData = Object.keys(npc._equipment).map(slotId => ({
              modelName: npc._equipment[slotId].modelName,
              effectId: npc._equipment[slotId].effectId || 0,
              textureAlias: npc._equipment[slotId].textureAlias || "Default",
              tintAlias: npc._equipment[slotId].tintAlias || "Default",
              decalAlias: npc._equipment[slotId].decalAlias || "#",
              slotId: parseInt(slotId),
              SHADER_PARAMETER_GROUP: npc._equipment[slotId].SHADER_PARAMETER_GROUP || []
            }));
            server.sendDataToAllWithSpawnedEntity(
              server._npcs, npcId, "Equipment.SetCharacterEquipment",
              {
                characterData: { profileId: 5, characterId: npcId },
                unknownDword1: 0, tintAlias: "Default", decalAlias: "#",
                equipmentSlots: equipmentSlots, attachmentData: attachmentData,
              }
            );
            console.log(`[EQUIP_ALL] Equipment packets sent for NPC ${npcId}`);
          } catch (error) {
            console.log(`[EQUIP_ALL] Error equipping NPC ${npcId}:`, error);
          }
        }, index * 500);
      } else {
        console.log(`[EQUIP_ALL] [WARNING] NPC ${npcId} has no equipment data`);
      }
    });
  }

  generateGuid(server) {
    return server.generateGuid();
  }

  patchNPCDeathSystem(server) {
    console.log(`[${this.name}] Patching NPC death system for hybrid loadout clearing...`);
    setTimeout(() => {
      console.log(`[${this.name}] [HYBRID] Patching damage function AFTER humanAI setup...`);
      try {
        const { Npc } = require(path.join(process.cwd(), 'node_modules/h1z1-server/out/servers/ZoneServer2016/entities/npc'));
        const humanAIPatchedDamage = Npc.prototype.damage;
        Npc.prototype.damage = async function(server, damageInfo) {
          if (this.isHumanNPC === true) {
            const actualHitLocation = damageInfo.hitReport?.hitLocation || damageInfo.hitLocation || '';
            const hitLower = actualHitLocation.toLowerCase();
            const shouldTriggerArmor = hitLower.includes('spine');
            const shouldTriggerHelmet = ['head', 'glasses', 'neck'].includes(hitLower);
            if (shouldTriggerArmor && this._loadout[38]) {
              damageInfo.damage = server.applyArmorDamageReduction(this, damageInfo.damage, 4);
            }
            if (shouldTriggerHelmet && this._loadout[11]) {
              damageInfo.damage = server.applyHelmetDamageReduction(this, damageInfo.damage, 1);
            }
          }
          const willDie = (this.health - damageInfo.damage) <= 0 && this.isAlive;
          
          // AGGRO-BASED: Remove from crowd when dying
          if (willDie && server.destroMOD && server.destroMOD.pathfinding) {
            if (this.wasAggroed && server.destroMOD.pathfinding.agents.has(this.characterId)) {
              console.log(`[${server.destroMOD.name}] Removing dying NPC ${this.characterId} from crowd`);
              server.destroMOD.pathfinding.removeAggroedNPC(this);
              this.wasAggroed = false;
            }
          }

          if (this.isHumanNPC === true && willDie && this._loadout && !this._loadoutCleared) {
            if (server.destroMOD?.captureDurabilityBeforeDeath) {
              server.destroMOD.captureDurabilityBeforeDeath(this);
            }
            this._loadout = {};
            this._loadoutCleared = true;
          }
          return await humanAIPatchedDamage.apply(this, arguments);
        };

        const originalOnProjectileHit = Npc.prototype.OnProjectileHit;
        Npc.prototype.OnProjectileHit = function(server, damageInfo) {
          if (this.isHumanNPC === true) {
            if (server.isHeadshotOnly && damageInfo.hitReport?.hitLocation != "HEAD" && this.isAlive) return;
            const client = server.getClientByCharId(damageInfo.entity);
            if (client && this.isAlive) {
              server.sendHitmarker(client, damageInfo.hitReport?.hitLocation, this.hasHelmet(server), this.hasArmor(server), this.hasHelmet(server), this.hasArmor(server));
            }
            if (["HEAD", "GLASSES", "NECK"].includes(damageInfo.hitReport?.hitLocation)) {
              damageInfo.damage *= 4;
            }
            this.damage(server, damageInfo);
          } else {
            return originalOnProjectileHit.apply(this, arguments);
          }
        };
        console.log(`[${this.name}] [HYBRID] Successfully patched both damage and OnProjectileHit functions`);
      } catch (error) {
        console.error(`[${this.name}] [HYBRID] Error patching functions:`, error.message);
      }
    }, 500);
  }

  captureDurabilityBeforeDeath(npc) {
    console.log(`[${this.name}] [DURABILITY] Capturing current durability from NPC loadout...`);
    if (!npc._loadout || !npc._equipmentDurability) return;
    const newDurabilityTracking = {};
    Object.values(npc._loadout).forEach(item => {
      if (item && item.itemDefinitionId && typeof item.currentDurability !== 'undefined') {
        if (item.currentDurability > 0) {
          newDurabilityTracking[item.itemDefinitionId] = item.currentDurability;
        }
      }
    });
    npc._equipmentDurability = newDurabilityTracking;
    console.log(`[${this.name}] [DURABILITY] Final durability tracking for loot:`, npc._equipmentDurability);
  }

  addHumanNPCLoot(server, client, lootbag, container, npc) {
    console.log(`[${this.name}] [HUMAN_LOOT] Adding custom human NPC loot with durability transfer...`);
    if (!npc) {
      const recentlyDied = Object.values(server._npcs).find(n => n.isHumanNPC && n.health <= 0 && n._equipmentDurability);
      if (recentlyDied) {
        npc = recentlyDied;
        console.log(`[${this.name}] [DURABILITY] Found recently died NPC with durability data`);
      }
    }
    const durabilityData = npc?._equipmentDurability || {};
    console.log(`[${this.name}] [DURABILITY] Using durability data:`, durabilityData);
    
    const ak47Durability = durabilityData[2229];
    if (ak47Durability && ak47Durability > 0) {
      const ak47Item = server.generateItem(2229, 1);
      if (ak47Item) {
        ak47Item.currentDurability = ak47Durability;
        server.addContainerItem(lootbag, ak47Item, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added AK-47 (durability: ${ak47Durability})`);
      }
    } else {
      console.log(`[${this.name}] [HUMAN_LOOT] AK-47 destroyed or missing - not added to loot`);
    }
    
    const ammo762Item = server.generateItem(2325, 30);
    if (ammo762Item) {
      server.addContainerItem(lootbag, ammo762Item, container);
      console.log(`[${this.name}] [HUMAN_LOOT] Added 7.62mm Ammo x30`);
    }
    
    const armorDurability = durabilityData[2271];
    if (armorDurability && armorDurability > 0) {
      const armorItem = server.generateItem(2271, 1);
      if (armorItem) {
        armorItem.currentDurability = armorDurability;
        server.addContainerItem(lootbag, armorItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added Laminated Tactical Body Armor (durability: ${armorDurability})`);
      }
    } else {
      console.log(`[${this.name}] [HUMAN_LOOT] Body Armor destroyed or missing - not added to loot`);
    }
    
    const helmetDurability = durabilityData[3414];
    if (helmetDurability && helmetDurability > 0) {
      const helmetItem = server.generateItem(3414, 1);
      if (helmetItem) {
        helmetItem.currentDurability = helmetDurability;
        server.addContainerItem(lootbag, helmetItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added Firefighter Tactical Helmet (durability: ${helmetDurability})`);
      }
    } else {
      console.log(`[${this.name}] [HUMAN_LOOT] Helmet destroyed or missing - not added to loot`);
    }
    
    if (Math.random() < 0.75) {
      const ammo9mmItem = server.generateItem(1998, 20);
      if (ammo9mmItem) {
        server.addContainerItem(lootbag, ammo9mmItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added 9mm Rounds x20`);
      }
    }
    
    const m9Item = server.generateItem(3381, 1, 500);
    if (m9Item) {
      server.addContainerItem(lootbag, m9Item, container);
      console.log(`[${this.name}] [HUMAN_LOOT] Added M9 Pistol`);
    }
    
    if (Math.random() < 0.60) {
      const firstAidItem = server.generateItem(78, 1);
      if (firstAidItem) {
        server.addContainerItem(lootbag, firstAidItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added First Aid Kit`);
      }
    }
    
    if (Math.random() < 0.80) {
      const bandageItem = server.generateItem(24, 3);
      if (bandageItem) {
        server.addContainerItem(lootbag, bandageItem, container);
        console.log(`[${this.name}] [HUMAN_LOOT] Added Bandages x3`);
      }
    }
    
    console.log(`[${this.name}] [HUMAN_LOOT] Custom human loot with durability transfer complete`);
  }

  debugNPCEquipment(server, npcId) {
    const npc = server._npcs[npcId];
    if (!npc) {
      console.log(`[DEBUG] NPC ${npcId} not found`);
      return;
    }
    console.log(`[DEBUG] AGGRO-BASED NPC Equipment Status for ${npcId}:`);
    console.log(`  - isHumanNPC: ${npc.isHumanNPC}`);
    console.log(`  - wasAggroed: ${npc.wasAggroed}`);
    console.log(`  - aiState: ${npc.aiState}`);
    console.log(`  - inCrowd: ${this.pathfinding?.agents?.has(npcId) || false}`);
    console.log(`  - loadoutId: ${npc.loadoutId}`);
    console.log(`  - currentLoadoutSlot: ${npc.currentLoadoutSlot}`);
    console.log(`  - gender: ${npc.gender}`);
    console.log(`  - headActor: ${npc.headActor}`);
    console.log(`  - Loadout items:`, Object.keys(npc._loadout || {}));
    console.log(`  - Equipment slots:`, Object.keys(npc._equipment || {}));
    if (npc._equipment) {
      Object.keys(npc._equipment).forEach(slotId => {
        const equipment = npc._equipment[slotId];
        console.log(`  - EquipSlot ${slotId}:`, { modelName: equipment.modelName, itemDefinitionId: equipment.itemDefinitionId, guid: equipment.guid });
      });
    }
    if (npc._loadout) {
      Object.keys(npc._loadout).forEach(slotId => {
        const item = npc._loadout[slotId];
        console.log(`  - LoadoutSlot ${slotId}:`, { itemDefinitionId: item.itemDefinitionId, currentDurability: item.currentDurability, guid: item.itemGuid });
      });
    }
    if (npc._equipmentDurability) {
      console.log(`  - Durability tracking:`, npc._equipmentDurability);
    }
    console.log(`  - 🎯 AGGRO-BASED: NPC uses crowd pathfinding only when aggroed`);
    console.log(`  - Empty loadout = NO death bag will be created`);
  }

  // NEW: Helper methods for debugging aggro-based system
  spawnOptimalHumanNPC(server, client) {
    console.log(`[${this.name}] Spawning OPTIMAL human NPC with AGGRO-BASED pathfinding...`);
    return this.spawnHumanNPC(server, client);
  }

  spawnOptimalZombieNPC(server, client) {
    console.log(`[${this.name}] Spawning OPTIMAL zombie NPC with AGGRO-BASED pathfinding...`);
    // This would spawn a zombie NPC - simplified for this example
    return true;
  }
}

module.exports = DestroMOD_AI_Plugin;